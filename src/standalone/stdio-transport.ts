import {parseJSONRPCMessage} from '@modelcontextprotocol/server';
import type {Transport,JSONRPCMessage,RequestId} from '@modelcontextprotocol/server';
import type {Readable,Writable} from 'node:stream';
import {REQUEST_BUDGETS,ownerRequestBudget,requestTimeoutMs} from './request-budget.js';
import {json} from './validation.js';

const PAGE_BYTES=64*1024,AFTER_CLOSE=Symbol('ontology-stdio-late-error');
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
type HeldRequest={bytes:number;timer:NodeJS.Timeout;negotiating:boolean;responding:boolean};
type Output={wire:string;bytes:number;id:RequestId|undefined;resolve:()=>void;reject:(error:Error)=>void};
export type StdioBudgetOptions={maxMessageBytes?:number;aggregateBytes?:number;maxResponseBytes?:number;maxRequests?:number;partialTimeoutMs?:number;requestGraceMs?:number};

/** Stable, non-payload diagnostics only. A closed channel never retries a write. */
export class StdioTransportError extends Error {
  constructor(readonly code:string){super(code);this.name='StdioTransportError';}
}

/** Newline JSON-RPC framing for the SDK's serveStdio era/session router.
 * Fixed pages avoid repeated whole-frame concatenation. Admission accounts for
 * encoded bytes in partial/queued frames, dispatched requests and pending output;
 * it is NOT a JavaScript heap/RSS limit or the formal worker's 2 GiB boundary.
 * The SDK retains protocol negotiation; this class never grants domain authority.
 */
export class BoundedStdioTransport implements Transport {
  onclose?:Transport['onclose'];
  onerror?:Transport['onerror'];
  onmessage?:Transport['onmessage'];
  sessionId?:string;
  private readonly frameLimit:number;
  private readonly incomingLimit:number;
  private readonly outputLimit:number;
  private readonly countLimit:number;
  private readonly partialTimeout:number;
  private readonly grace:number;
  private started=false;
  private closed=false;
  private pages:Buffer[]=[];
  private pageUsed=0;
  private frameBytes=0;
  private pending:Buffer|undefined;
  private pendingOffset=0;
  private rawBytes=0;
  private heldBytes=0;
  private transientBytes=0;
  private held=new Map<RequestId,HeldRequest>();
  private output:Output[]=[];
  private outputBytes=0;
  private writing=false;
  private scheduled:NodeJS.Immediate|undefined;
  private delivered:NodeJS.Immediate|undefined;
  private partialTimer:NodeJS.Timeout|undefined;

  constructor(private readonly input:Readable=process.stdin,private readonly destination:Writable=process.stdout,options:StdioBudgetOptions={}){
    const bounded=(value:number|undefined,maximum:number):number=>{
      const selected=value??maximum;
      if(!Number.isSafeInteger(selected)||selected<1||selected>maximum)throw new StdioTransportError('STDIO_INVALID_BUDGET');
      return selected;
    };
    this.frameLimit=bounded(options.maxMessageBytes,REQUEST_BUDGETS.maxWireBytes);
    this.outputLimit=bounded(options.maxResponseBytes,REQUEST_BUDGETS.mcpResponseBytes);
    this.incomingLimit=bounded(options.aggregateBytes,REQUEST_BUDGETS.aggregateBytes)-this.outputLimit;
    if(this.incomingLimit<this.frameLimit)throw new StdioTransportError('STDIO_INVALID_BUDGET');
    this.countLimit=bounded(options.maxRequests,REQUEST_BUDGETS.activeRequests);
    this.partialTimeout=bounded(options.partialTimeoutMs,REQUEST_BUDGETS.largeTimeoutMs+15000);
    this.grace=bounded(options.requestGraceMs,15000);
  }

  private report(error:Error):void{try{this.onerror?.(error);}catch{/* Error reporting cannot keep a broken channel alive. */}}
  private stop(code:string):void{if(this.closed)return;this.report(new StdioTransportError(code));void this.close();}
  private inputError=():void=>this.stop('STDIO_INPUT_ERROR');
  private outputError=():void=>this.stop('STDIO_OUTPUT_ERROR');
  private outputClose=():void=>this.stop('STDIO_OUTPUT_CLOSED');
  private ended=():void=>{if(this.rawBytes)this.stop('STDIO_TRUNCATED');else void this.close();};
  private readable=():void=>this.schedule();

  async start():Promise<void>{
    if(this.started||this.closed)throw new StdioTransportError('STDIO_ALREADY_STARTED');
    this.started=true;
    for(const listener of this.destination.listeners('error'))if((listener as unknown as Record<symbol,unknown>)[AFTER_CLOSE])this.destination.off('error',listener as (...args:unknown[])=>void);
    this.input.pause();
    this.input.on('readable',this.readable);this.input.on('end',this.ended);this.input.on('close',this.ended);this.input.on('error',this.inputError);
    this.destination.on('error',this.outputError);this.destination.on('close',this.outputClose);
    if(this.input.readableEnded||this.input.destroyed){this.ended();return;}
    if(this.destination.destroyed||this.destination.writableEnded){this.outputClose();return;}
    this.schedule();
  }

  private schedule():void{
    if(this.closed||!this.started||this.scheduled||this.delivered)return;
    this.scheduled=setImmediate(()=>{this.scheduled=undefined;try{this.pump();}catch{this.stop('STDIO_INVALID_MESSAGE');}});
  }
  private startPartial():void{
    if(this.partialTimer)return;
    this.partialTimer=setTimeout(()=>this.stop('STDIO_FRAME_TIMEOUT'),this.partialTimeout);this.partialTimer.unref();
  }
  private clearPartial():void{if(this.partialTimer)clearTimeout(this.partialTimer);this.partialTimer=undefined;}
  private append(bytes:Buffer):void{
    let offset=0;
    while(offset<bytes.length){
      if(!this.pages.length||this.pageUsed===this.pages.at(-1)!.length){
        this.pages.push(Buffer.allocUnsafe(Math.min(PAGE_BYTES,this.frameLimit-this.frameBytes)));
        this.pageUsed=0;
      }
      const page=this.pages.at(-1)!,n=Math.min(bytes.length-offset,page.length-this.pageUsed);
      bytes.copy(page,this.pageUsed,offset,offset+n);this.pageUsed+=n;this.frameBytes+=n;offset+=n;
    }
  }
  private pump():void{
    // serveStdio's factory/negotiation and stdout draining may await. Do not feed
    // their internal void-callback queue during either wait. Between messages,
    // yield a full turn so notification dispatch completes before admitting more.
    if(this.closed||this.output.length||this.held.size>=this.countLimit||[...this.held.values()].some(x=>x.negotiating))return;
    if(!this.pending){
      const free=this.incomingLimit-this.rawBytes-this.heldBytes-this.transientBytes;
      if(free<=0)return;
      const available=this.input.readableLength;
      if(!available){this.input.read(0);return;}
      const n=Math.min(PAGE_BYTES,available,free,this.frameLimit-this.frameBytes+1);
      const chunk:unknown=this.input.read(n);
      if(chunk===null)return;
      if(!Buffer.isBuffer(chunk)){this.stop('STDIO_BINARY_REQUIRED');return;}
      this.pending=chunk;this.pendingOffset=0;this.rawBytes+=chunk.length;this.startPartial();
    }
    const chunk=this.pending,index=chunk.indexOf(10,this.pendingOffset),end=index<0?chunk.length:index;
    const count=end-this.pendingOffset;
    if(this.frameBytes+count>this.frameLimit){this.stop('STDIO_FRAME_LIMIT');return;}
    this.append(chunk.subarray(this.pendingOffset,end));
    this.pendingOffset=end+(index<0?0:1);
    if(this.pendingOffset===chunk.length){this.pending=undefined;this.pendingOffset=0;}
    if(index<0){this.schedule();return;}
    const bytes=this.frameBytes+1;
    const complete=this.pages.length===1?this.pages[0].subarray(0,this.pageUsed):Buffer.concat(this.pages.map((p,i)=>i===this.pages.length-1?p.subarray(0,this.pageUsed):p),this.frameBytes);
    this.pages=[];this.pageUsed=0;this.frameBytes=0;this.rawBytes-=bytes;this.clearPartial();
    if(this.pending)this.startPartial();
    let message:JSONRPCMessage,operation:unknown;
    try{
      const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(complete));
      json(value,this.frameLimit);
      const params=record(value)&&record(value.params)?value.params:undefined;
      const args=params&&record(params.arguments)?params.arguments:undefined;
      operation=record(value)&&value.method==='tools/call'&&params?.name==='ontology_write'?args?.operation:undefined;
      const encodedBytes=Buffer.byteLength(JSON.stringify(value)),argumentBytes=args?Buffer.byteLength(JSON.stringify(args)):0;
      const allowed=ownerRequestBudget(operation)+REQUEST_BUDGETS.mcpEnvelopeBytes;
      // Check original members before SDK parsing can drop unknown properties.
      // A document budget never authorizes an oversized _meta/outer envelope.
      if(bytes-1>allowed||encodedBytes>allowed||(args&&encodedBytes-argumentBytes>REQUEST_BUDGETS.mcpEnvelopeBytes)){this.stop('STDIO_FRAME_LIMIT');return;}
      message=parseJSONRPCMessage(value);
    }catch{this.stop('STDIO_INVALID_MESSAGE');return;}
    const request='method' in message&&'id' in message;
    if('method' in message&&'id' in message){
      if(this.held.has(message.id)){this.stop('STDIO_DUPLICATE_ID');return;}
      const timer=setTimeout(()=>this.stop('STDIO_REQUEST_TIMEOUT'),requestTimeoutMs(operation)+this.grace);timer.unref();
      this.held.set(message.id,{bytes,timer,negotiating:message.method==='initialize'||message.method==='server/discover',responding:false});this.heldBytes+=bytes;
    }else this.transientBytes+=bytes;
    // No new frame enters the SDK in the same turn, including coalesced input.
    this.delivered=setImmediate(()=>{this.delivered=undefined;if(!request)this.transientBytes=Math.max(0,this.transientBytes-bytes);this.schedule();});
    try{this.onmessage?.(message);}catch{this.stop('STDIO_DISPATCH_ERROR');}
  }

  /** Only the owning handler calls this after cancelled work has actually left
   * its finally block. A cancellation notification alone cannot free admission. */
  releaseCancelledRequest(id:RequestId):void{this.release(id);}
  private release(id:RequestId):void{
    const held=this.held.get(id);if(!held)return;
    clearTimeout(held.timer);this.held.delete(id);this.heldBytes-=held.bytes;this.schedule();
  }

  send(message:JSONRPCMessage):Promise<void>{
    if(this.closed)return Promise.reject(new StdioTransportError('STDIO_CLOSED'));
    let wire:string;try{wire=JSON.stringify(message)+'\n';}catch{this.stop('STDIO_INVALID_OUTPUT');return Promise.reject(new StdioTransportError('STDIO_INVALID_OUTPUT'));}
    const bytes=Buffer.byteLength(wire),id=!('method' in message)&&'id' in message&&message.id!==null?message.id:undefined;
    if(bytes>this.outputLimit||this.outputBytes+bytes>this.outputLimit||this.output.length>=this.countLimit+1){this.stop('STDIO_OUTPUT_LIMIT');return Promise.reject(new StdioTransportError('STDIO_OUTPUT_LIMIT'));}
    const held=id===undefined?undefined:this.held.get(id);
    if(held?.responding){this.stop('STDIO_DUPLICATE_RESPONSE');return Promise.reject(new StdioTransportError('STDIO_DUPLICATE_RESPONSE'));}
    if(held)held.responding=true;
    return new Promise<void>((resolve,reject)=>{this.output.push({wire,bytes,id,resolve,reject});this.outputBytes+=bytes;this.flush();});
  }
  private flush():void{
    if(this.closed||this.writing||!this.output.length)return;
    const item=this.output[0];this.writing=true;
    try{this.destination.write(item.wire,'utf8',(error?:Error|null)=>{
      if(this.closed)return;
      if(error){this.stop('STDIO_OUTPUT_ERROR');return;}
      this.output.shift();this.outputBytes-=item.bytes;this.writing=false;
      if(item.id!==undefined)this.release(item.id);
      item.resolve();this.flush();this.schedule();
    });}catch{this.stop('STDIO_OUTPUT_ERROR');}
  }
  async close():Promise<void>{
    if(this.closed)return;this.closed=true;
    if(this.scheduled)clearImmediate(this.scheduled);if(this.delivered)clearImmediate(this.delivered);
    this.scheduled=undefined;this.delivered=undefined;this.clearPartial();
    this.input.off('readable',this.readable);this.input.off('end',this.ended);this.input.off('close',this.ended);this.input.off('error',this.inputError);this.input.pause();
    this.destination.off('close',this.outputClose);
    // A queued write may emit its error after close; retain one inert listener.
    // start() removes tagged leftovers when reusing the same destination.
    (this.outputError as unknown as Record<symbol,unknown>)[AFTER_CLOSE]=true;
    for(const held of this.held.values())clearTimeout(held.timer);this.held.clear();
    const error=new StdioTransportError('STDIO_CLOSED');for(const item of this.output)item.reject(error);
    this.output=[];this.outputBytes=0;this.writing=false;this.pending=undefined;this.pages=[];this.frameBytes=0;this.pageUsed=0;this.rawBytes=0;this.heldBytes=0;this.transientBytes=0;
    try{this.onclose?.();}catch{/* The connection is already closed. */}
  }
}
