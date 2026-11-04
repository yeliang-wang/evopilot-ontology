import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {execFile} from 'node:child_process';
import {readDLToolchain,verifyDLToolchain,javaClasspath} from '../../dist/reasoning/toolchain.js';
import {hashBytes} from '../../dist/standalone/validation.js';

// Independent generic grammar and resolution oracles, not java.net.URI or an
// upstream parser's output. RFC3987 2.2/6.5, RFC3986 3.2.2/5.2/5.4 and Turtle 6.3.
// Actual current worker classes are loaded; no mock, skip or source fallback.
const javaSource=String.raw`
import java.io.*;
import java.nio.file.*;
import java.util.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.semanticweb.owlapi.model.IRI;
import org.semanticweb.owlapi.rdf.turtle.parser.*;
public final class TurtleIRIProbe {
  static final ObjectMapper J=new ObjectMapper();
  static final class Sink implements TripleHandler {
    final ArrayNode rows=J.createArrayNode();
    public void handleTriple(IRI s,IRI p,IRI o){var r=rows.addArray();r.add(s.toString());r.add(p.toString());r.add(o.toString());}
    public void handleTriple(IRI s,IRI p,String o){throw new IllegalStateException("Unexpected literal");}
    public void handleTriple(IRI s,IRI p,String o,String l){throw new IllegalStateException("Unexpected language");}
    public void handleTriple(IRI s,IRI p,String o,IRI d){throw new IllegalStateException("Unexpected datatype");}
    public void handlePrefixDirective(String n,String iri){}
    public void handleBaseDirective(IRI iri){}
    public void handleComment(String s){}
    public void handleEnd(){}
  }
  static String string(JsonNode v){return v.isNull()?null:v.asText();}
  static void fatal(Throwable e){if(e instanceof VirtualMachineError v)throw v;if(e instanceof ThreadDeath v)throw v;}
  static ObjectNode run(JsonNode input)throws Exception {
    var out=J.createObjectNode();String mode=input.path("mode").asText("reference");
    if(!mode.equals("parse")){
      try{
        String value=string(input.get("value"));
        if(mode.equals("reference"))RDFIRI.validateReference(value);
        else if(mode.equals("absolute"))RDFIRI.validateAbsolute(value);
        else if(mode.equals("resolve"))value=RDFIRI.resolve(value,string(input.get("base")));
        else throw new IllegalArgumentException("Unknown probe mode");
        out.put("status","VALID");out.put("value",value);
      }catch(RDFIRI.Syntax e){out.put("status","INVALID");out.put("errorClass",e.getClass().getName());}
      return out;
    }
    String content=input.path("content").asText();IRI base=IRI.create(input.path("base").asText());
    for(boolean located:List.of(false,true)){
      String key=located?"located":"ordinary";var sink=new Sink();
      try{
        if(located){
          int[] active={0};var result=LocatedTurtleParser.parse(content,base,sink,new LocatedTurtleParser.OccurrenceObserver(){
            public void beforeTriple(int id){if(active[0]!=0)throw new IllegalStateException("Nested observer");active[0]=id;}
            public void afterTriple(){if(active[0]==0)throw new IllegalStateException("Missing observer");active[0]=0;}
          },200000);
          if(active[0]!=0)throw new IllegalStateException("Observer retained");
          var ranges=out.putArray("ranges");for(var s:result.sources()){
            var r=ranges.addObject();r.put("text",content.substring(s.span().start(),s.span().end()));r.put("start",s.span().start());r.put("end",s.span().end());
          }
        }else LocatedTurtleParser.parseUnlocated(content,base,sink);
        out.put(key,"PARSED");
      }catch(Throwable e){fatal(e);out.put(key,"REJECTED");out.put(key+"Error",e.toString());}
      out.set(key+"Triples",sink.rows);
    }
    return out;
  }
  public static void main(String[] args)throws Exception {
    var out=J.createObjectNode();out.put("origin",Path.of(RDFIRI.class.getProtectionDomain().getCodeSource().getLocation().toURI()).toRealPath().toString());
    var results=out.putArray("results");for(var input:J.readTree(Files.readAllBytes(Path.of(args[0]))))results.add(run(input));
    System.out.println(J.writeValueAsString(out));
  }
}
`;
let root,binding,classes,classpath,sequence=0;
const execute=(file,args)=>new Promise((resolve,reject)=>execFile(file,args,{timeout:45000,maxBuffer:16*1024*1024},(error,stdout,stderr)=>error?reject(Error(`${error.message}\n${stdout}\n${stderr}`)):resolve(stdout)));
before(async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN,'An actual current DL binding is required');
  binding=readDLToolchain(process.env.EVOPILOT_TEST_DL_TOOLCHAIN);verifyDLToolchain(binding);
  assert.equal(binding.workerSourceDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/Worker.java',import.meta.url))));
  assert.equal(binding.dependencyLockDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/dependencies.json',import.meta.url))));
  root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-turtle-iri-')));classes=join(root,'classes');mkdirSync(classes,{mode:0o700});
  const source=join(root,'TurtleIRIProbe.java');writeFileSync(source,javaSource,{mode:0o600});classpath=javaClasspath(binding);
  await execute(join(binding.javaRoot,'bin/javac'),['-encoding','UTF-8','-cp',classpath,'-d',classes,source]);
});
after(()=>{try{if(binding)verifyDLToolchain(binding);}finally{if(root)rmSync(root,{recursive:true,force:true});}});
async function inspect(cases){
  const input=join(root,`input-${++sequence}.json`);writeFileSync(input,JSON.stringify(cases),{mode:0o600});
  const result=JSON.parse(await execute(join(binding.javaRoot,'bin/java'),['-Xmx256m','-cp',[classes,classpath].join(delimiter),'TurtleIRIProbe',input]));
  assert.equal(result.origin,realpathSync(join(binding.root,'worker.jar')));assert.equal(result.results.length,cases.length);return result.results;
}
async function grammar(valid,invalid,mode='reference'){
  const inputs=[...valid,...invalid],results=await inspect(inputs.map(value=>({mode,value})));
  for(const [i,r] of results.entries()){
    assert.equal(r.status,i<valid.length?'VALID':'INVALID',JSON.stringify(inputs[i])+' '+JSON.stringify(r));
    if(i<valid.length)assert.equal(r.value,inputs[i],'Validation must preserve exact input');
    else assert.equal(r.errorClass,'org.semanticweb.owlapi.rdf.turtle.parser.RDFIRI$Syntax');
  }
}
const base='http://a/b/c/d;p?q';
// All normal and abnormal RFC3986 5.4 examples, using strict same-scheme handling.
const resolution=[
  ['g:h','g:h'],['g','http://a/b/c/g'],['./g','http://a/b/c/g'],['g/','http://a/b/c/g/'],['/g','http://a/g'],['//g','http://g'],
  ['?y','http://a/b/c/d;p?y'],['g?y','http://a/b/c/g?y'],['#s','http://a/b/c/d;p?q#s'],['g#s','http://a/b/c/g#s'],['g?y#s','http://a/b/c/g?y#s'],
  [';x','http://a/b/c/;x'],['g;x','http://a/b/c/g;x'],['g;x?y#s','http://a/b/c/g;x?y#s'],['','http://a/b/c/d;p?q'],
  ['.','http://a/b/c/'],['./','http://a/b/c/'],['..','http://a/b/'],['../','http://a/b/'],['../g','http://a/b/g'],['../..','http://a/'],['../../','http://a/'],['../../g','http://a/g'],
  ['../../../g','http://a/g'],['../../../../g','http://a/g'],['/./g','http://a/g'],['/../g','http://a/g'],['g.','http://a/b/c/g.'],['.g','http://a/b/c/.g'],['g..','http://a/b/c/g..'],['..g','http://a/b/c/..g'],
  ['./../g','http://a/b/g'],['./g/.','http://a/b/c/g/'],['g/./h','http://a/b/c/g/h'],['g/../h','http://a/b/c/h'],['g;x=1/./y','http://a/b/c/g;x=1/y'],['g;x=1/../y','http://a/b/c/y'],
  ['g?y/./x','http://a/b/c/g?y/./x'],['g?y/../x','http://a/b/c/g?y/../x'],['g#s/./x','http://a/b/c/g#s/./x'],['g#s/../x','http://a/b/c/g#s/../x'],['http:g','http:g']
];

test('generic IRI-reference components preserve identifiers without DNS, port, byte-encoding or scheme policy',async()=>{
  await grammar(['','?','#','?#','a','/','//','///','//host','//user:pass@host:','//:123','a:b','a:','a:/','a://','a:?q#f','A+1.-:x','./1:a',
    'urn:x%FF','urn:x%00','urn:x%c0%af','urn:x%2f','urn:x%2E%2e/','urn:x?x=/?#f/?','http://1.example1/','http://999.999.999.999/',
    'x://user:pass!$&\'()*+,;=%FF@名.example:2147483648/p','x://example:'+('9'.repeat(20000))+'/p','x://'+('a'.repeat(20000))+'/',
    'urn:é','urn:e\u0301','jar:http://example/a.jar!/b'],
  [null,'1:a',':a','a_b:c','a%20:b','a\\b','urn:x%','urn:x%0','urn:x%GG','urn:x%０0','urn:x[a]','urn:x?q[a]','urn:x#f[a]','urn:x#a#b',
    'x://u@v@h/','x://h:1:2/','x://h:abc/','x://h:-1/','x://h:+1/','x://h:１２/','x://h]','x://[::1]junk/','x://[::1]:1:2/','x://a\\b/']);
  await grammar(['urn:x#fragment','x:','x://host/?#'],['','relative','/absolute-path','//authority','?query','#fragment'],'absolute');
});

test('IP literals cover every IPv6 compression position, embedded IPv4 and IPvFuture grammar',async()=>{
  const ipv6=['1:2:3:4:5:6:7:8','::1:2:3:4:5:6:7','1::2:3:4:5:6:7','1:2::3:4:5:6:7','1:2:3::4:5:6:7','1:2:3:4::5:6:7','1:2:3:4:5::6:7','1:2:3:4:5:6::7','1:2:3:4:5:6:7::','::','::1','ABCD:ef01:2345:6789:abcd:ef01:2345:6789','1:2:3:4:5:6:192.0.2.1','::ffff:192.0.2.128','::192.0.2.1'];
  const invalid=['','notipv6','1:2:3:4:5:6:7','1:2:3:4:5:6:7:8:9','1:2:3:4:5:6:7:8::','1::2::3',':::1','1:::','1:2:3:4:5:6:7:','12345::','gggg::','192.0.2.1','1:2:3:4:5:192.0.2.1','::192.0.2.256','::192.00.2.1','::192.0.2','::192.0.2.1:3','192.0.2.1::','fe80::1%25eth0','v.foo','v1.','vG.foo','v1.a%20','v1.雪','v1.a@b'];
  await grammar([...ipv6,'v1.future:address','VF.a!$&\'()*+,;=~._-:9'].map(v=>'x://['+v+']:80/p'),invalid.map(v=>'x://['+v+']/'));
});

test('complete RFC3987 Unicode ranges and query-only private characters reject scalars outside the grammar',async()=>{
  const allowed=[0xA0,0xD7FF,0xF900,0xFDCF,0xFDF0,0xFFEF,0xE1000,0xEFFFD,0x2028,0x2029];
  for(let plane=1;plane<=13;plane++)allowed.push(plane*0x10000,plane*0x10000+0xFFFD);
  const forbidden=[0,0x20,0x7F,0x80,0x9F,0xD800,0xDFFF,0xFDD0,0xFDEF,0xFFF0,0xFFFF,0xE0000,0xE0FFF];
  for(let plane=1;plane<=16;plane++)forbidden.push(plane*0x10000+0xFFFE,plane*0x10000+0xFFFF);
  const privates=[0xE000,0xF8FF,0xF0000,0xFFFFD,0x100000,0x10FFFD];
  const cp=String.fromCodePoint;
  await grammar([...allowed.map(c=>'urn:x'+cp(c)),...privates.map(c=>'urn:x?q='+cp(c))],
    [...forbidden.map(c=>'urn:x'+cp(c)),...privates.flatMap(c=>['urn:x'+cp(c),'urn:x#?'+cp(c),'urn:x?q#'+cp(c),'x://'+cp(c)+'/'])]);
});

test('strict RFC3986 normal and abnormal resolution examples retain empty components and original Unicode spelling',async()=>{
  const extra=[
    ['','https://EXAMPLE/雪/e\u0301?%FF#ignored','https://EXAMPLE/雪/e\u0301?%FF'],
    ['?','http://a/b?old#ignored','http://a/b?'],['#','http://a/b?old#ignored','http://a/b?old#'],['?#','http://a/b?old#ignored','http://a/b?#'],
    ['g','http://a','http://a/g'],['g','x:','x:g'],['../g','x:a/b','x:/g'],['%2e/%2E%2e/x','http://a/b/','http://a/b/%2e/%2E%2e/x'],
    ['../雪?%FF#é','https://EXAMPLE/a/b/c','https://EXAMPLE/a/雪?%FF#é'],['//','x://a/b','x://'],['/a//b/../c/.','x://h/z','x://h/a//c/'],
    ['x:/a/./b/../c','http://a/b','x:/a/c'],['g','urn:example:a','urn:g']
  ];
  const cases=[...resolution.map(([value,expected])=>({mode:'resolve',value,base,expected})),...extra.map(([value,base,expected])=>({mode:'resolve',value,base,expected}))];
  const results=await inspect(cases);for(const [i,r] of results.entries()){assert.equal(r.status,'VALID',JSON.stringify(cases[i]));assert.equal(r.value,cases[i].expected,JSON.stringify(cases[i]));}
  const failures=await inspect([{mode:'resolve',value:'a',base:'relative'},{mode:'resolve',value:'a',base:null},{mode:'resolve',value:'%GG',base},{mode:'resolve',value:'http://h',base:'http://[bad]/'}]);
  for(const r of failures)assert.equal(r.status,'INVALID');
});

test('ordinary and located Turtle parsing use the independent complete RFC resolution oracle',async()=>{
  const cases=resolution.map(([reference,expected])=>({mode:'parse',base,content:'<'+reference+'> <urn:p> <urn:o> .',expected,reference}));
  const results=await inspect(cases);
  for(const [i,r] of results.entries()){
    assert.equal(r.ordinary,'PARSED',JSON.stringify(cases[i])+' '+JSON.stringify(r));assert.equal(r.located,'PARSED',JSON.stringify(r));
    assert.deepEqual(r.ordinaryTriples,[[cases[i].expected,'urn:p','urn:o']]);assert.deepEqual(r.locatedTriples,r.ordinaryTriples);
    assert.ok(r.ranges.some(s=>s.text==='<'+cases[i].reference+'>'));
  }
});

test('IRI structural failures in terms, BASE and PREFIX reject in both parser modes without a successful source table',async()=>{
  const invalid=['1:a','urn:x%','urn:x%GG','urn:x[a]','urn:x?q[a]','urn:x#f[a]','urn:x#a#b','x://[notipv6]/','x://[1:2:3:4:5:6:7:8::]/','x://[::192.0.2.256]/','x://h:-1/',String.raw`urn:x\u0025ZZ`];
  const cases=invalid.flatMap(value=>[
    {mode:'parse',base,content:'<'+value+'> <urn:p> <urn:o> .'},
    {mode:'parse',base,content:'@base <'+value+'> . <s> <urn:p> <urn:o> .'},
    {mode:'parse',base,content:'@prefix x: <'+value+'> . x:s <urn:p> <urn:o> .'}
  ]);
  const results=await inspect(cases);for(const [i,r] of results.entries()){assert.equal(r.ordinary,'REJECTED',JSON.stringify(cases[i]));assert.equal(r.located,'REJECTED',JSON.stringify(cases[i]));assert.equal(r.ranges,undefined);}
});

test('relative BASE chains, namespace capture and escaped repeated references follow current state without normalization',async()=>{
  const content=String.raw`@base <https://first.example/a/b/?old#ignored> .
@prefix held: <../vocab/> .
<\u0073> held:p <../o> .
@base <../second/> .
<s> held:p <../o> .
@base <?new> .
<> held:p <#fragment> .
@prefix fresh: <./vocab/> .
<s> fresh:p <urn:x%FF> .`;
  const [r]=await inspect([{mode:'parse',base,content}]);assert.equal(r.ordinary,'PARSED',JSON.stringify(r));assert.equal(r.located,'PARSED',JSON.stringify(r));
  assert.deepEqual(r.ordinaryTriples,[
    ['https://first.example/a/b/s','https://first.example/a/vocab/p','https://first.example/a/o'],
    ['https://first.example/a/second/s','https://first.example/a/vocab/p','https://first.example/a/o'],
    ['https://first.example/a/second/?new','https://first.example/a/vocab/p','https://first.example/a/second/?new#fragment'],
    ['https://first.example/a/second/s','https://first.example/a/second/vocab/p','urn:x%FF']
  ]);assert.deepEqual(r.locatedTriples,r.ordinaryTriples);assert.ok(r.ranges.some(s=>s.text===String.raw`<\u0073>`));
});
