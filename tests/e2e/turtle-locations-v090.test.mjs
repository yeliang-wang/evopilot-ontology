import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {execFile} from 'node:child_process';
import {readDLToolchain,verifyDLToolchain,javaClasspath} from '../../dist/reasoning/toolchain.js';
import {hashBytes} from '../../dist/standalone/validation.js';

// Actual lexer/parser development evidence. Original callback parity is distinct
// from native OWL source-set attribution and from formal standards acceptance.
const javaSource=String.raw`
import java.io.*;
import java.nio.file.*;
import java.util.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.semanticweb.owlapi.model.IRI;
import org.semanticweb.owlapi.model.NodeID;
import org.semanticweb.owlapi.rdf.turtle.parser.*;

public final class TurtleLocationsProbe {
  static final ObjectMapper JSON=new ObjectMapper();
  static final IRI BASE=IRI.create("https://example.test/document");
  static final class Recorder implements TripleHandler {
    final ArrayNode events=JSON.createArrayNode();final Map<String,String> anonymous=new LinkedHashMap<>();
    String iri(IRI v){if(v==null)return null;String s=v.toString();return NodeID.isAnonymousNodeIRI(v)||NodeID.isAnonymousNodeID(s)?anonymous.computeIfAbsent(s,k->"_:observed"+(anonymous.size()+1)):s;}
    void row(String kind,IRI s,IRI p,IRI o,String literal,String language,IRI datatype){
      var r=events.addObject();r.put("kind",kind);r.put("subject",iri(s));r.put("predicate",iri(p));r.put("resource",iri(o));r.put("literal",literal);r.put("language",language);r.put("datatype",iri(datatype));
    }
    public void handleTriple(IRI s,IRI p,IRI o){row("RESOURCE",s,p,o,null,null,null);}
    public void handleTriple(IRI s,IRI p,String o){row("STRING",s,p,null,o,null,null);}
    public void handleTriple(IRI s,IRI p,String o,String lang){row("LANGUAGE",s,p,null,o,lang,null);}
    public void handleTriple(IRI s,IRI p,String o,IRI datatype){row("TYPED",s,p,null,o,null,datatype);}
    public void handlePrefixDirective(String name,String iri){events.addObject().put("kind","PREFIX").put("name",name).put("value",iri);}
    public void handleBaseDirective(IRI iri){events.addObject().put("kind","BASE").put("value",iri.toString());}
    public void handleComment(String comment){events.addObject().put("kind","COMMENT").put("value",comment);}
    public void handleEnd(){events.addObject().put("kind","END");}
  }
  static ObjectNode term(LocatedTurtleParser.TermSource term){
    var out=JSON.createObjectNode();out.put("sourceId",term.sourceId());out.put("inherited",term.inherited());out.put("generated",term.generated());out.set("contextIds",JSON.valueToTree(term.contextIds()));return out;
  }
  static final class Counter implements TripleHandler {
    int resources,plain,languages,datatypes,prefixes,bases,ends;
    public void handleTriple(IRI s,IRI p,IRI o){resources++;}
    public void handleTriple(IRI s,IRI p,String o){plain++;}
    public void handleTriple(IRI s,IRI p,String o,String lang){languages++;}
    public void handleTriple(IRI s,IRI p,String o,IRI datatype){datatypes++;}
    public void handlePrefixDirective(String name,String iri){prefixes++;}
    public void handleBaseDirective(IRI iri){bases++;}
    public void handleComment(String comment){}
    public void handleEnd(){ends++;}
    ObjectNode json(){var v=JSON.createObjectNode();v.put("resources",resources);v.put("plain",plain);v.put("languages",languages);v.put("datatypes",datatypes);v.put("prefixes",prefixes);v.put("bases",bases);v.put("ends",ends);return v;}
  }
  static void fatal(Throwable error){
    if(error instanceof VirtualMachineError value)throw value;
    if(error instanceof ThreadDeath value)throw value;
  }
  static ObjectNode run(JsonNode input)throws Exception {
    String content=input.path("content").asText();var out=JSON.createObjectNode();var original=new Recorder();var located=new Recorder();
    if(input.path("countOnly").asBoolean(false)){
      var oldCounter=new Counter();var newCounter=new Counter();
      new TurtleParser(new StringReader(content),oldCounter,BASE).parseDocument();
      LocatedTurtleParser.parseUnlocated(content,BASE,newCounter);
      out.set("originalCounts",oldCounter.json());out.set("unlocatedCounts",newCounter.json());return out;
    }
    try{new TurtleParser(new StringReader(content),original,BASE).parseDocument();out.put("originalStatus","PARSED");}catch(Throwable e){fatal(e);out.put("originalStatus","PARSE_ERROR");out.put("originalError",e.toString());}
    var unlocated=new Recorder();
    try{LocatedTurtleParser.parseUnlocated(content,BASE,unlocated);out.put("unlocatedStatus","PARSED");}catch(Throwable e){fatal(e);out.put("unlocatedStatus","PARSE_ERROR");out.put("unlocatedError",e.toString());}
    out.set("unlocatedEvents",unlocated.events);
    out.set("originalEvents",original.events);var observed=new ArrayList<Integer>();int[] active={0};
    LocatedTurtleParser.Result result=null;
    try{
      result=LocatedTurtleParser.parse(content,BASE,located,new LocatedTurtleParser.OccurrenceObserver(){
        public void beforeTriple(int id){if(id<1||active[0]!=0)throw new IllegalStateException("Occurrence observer nesting");active[0]=id;observed.add(id);}
        public void afterTriple(){if(active[0]==0)throw new IllegalStateException("Missing observer entry");active[0]=0;}
      },input.path("limit").asInt(200000));out.put("locatedStatus","PARSED");
    }catch(LocatedTurtleParser.LimitException e){out.put("locatedStatus","LIMIT");}catch(Throwable e){fatal(e);out.put("locatedStatus","PARSE_ERROR");out.put("error",e.toString());}
    out.put("returned",result!=null);out.put("observerActive",active[0]);out.set("observedIds",JSON.valueToTree(observed));out.set("locatedEvents",located.events);
    if(result!=null){
      ArrayNode sources=out.putArray("sources");for(var s:result.sources()){var r=sources.addObject();r.put("id",s.id());r.put("kind",String.valueOf(s.kind()));r.put("start",s.span().start());r.put("end",s.span().end());r.put("text",content.substring(s.span().start(),s.span().end()));}
      ArrayNode contexts=out.putArray("contexts");for(var c:result.contexts()){var r=contexts.addObject();r.put("id",c.id());r.put("kind",String.valueOf(c.kind()));r.put("prefixName",c.prefixName());r.put("resolved",c.resolved()==null?null:c.resolved().toString());r.put("sourceId",c.sourceId());r.set("dependencies",JSON.valueToTree(c.dependencyContextIds()));}
      ArrayNode occurrences=out.putArray("occurrences");for(var o:result.occurrences()){
        var r=occurrences.addObject();r.put("id",o.id());r.put("generatedKind",o.generatedKind());r.set("subject",term(o.subject()));r.set("predicate",term(o.predicate()));r.set("object",term(o.object()));
        var t=o.triple();var tuple=r.putObject("triple");tuple.put("subject",located.iri(t.subject()));tuple.put("predicate",located.iri(t.predicate()));tuple.put("resource",located.iri(t.resourceObject()));tuple.put("literal",t.lexicalObject());tuple.put("language",t.language());tuple.put("datatype",located.iri(t.datatype()));
      }
    }
    return out;
  }
  static String origin(Class<?> c)throws Exception{return Path.of(c.getProtectionDomain().getCodeSource().getLocation().toURI()).toRealPath().toString();}
  public static void main(String[] args)throws Exception {
    var input=JSON.readTree(Files.readAllBytes(Path.of(args[0])));var out=JSON.createObjectNode();var classes=out.putObject("classes");
    for(String name:List.of("TurtleParser","JavaCharStream","TurtleParserTokenManager","LocatedTurtleParser","LocatedTurtleSyntaxParser","LocatedTurtleCharStream","LocatedTurtleTokenManager"))classes.put(name,origin(Class.forName("org.semanticweb.owlapi.rdf.turtle.parser."+name)));
    var cases=out.putArray("cases");for(var item:input)cases.add(run(item));System.out.println(JSON.writeValueAsString(out));
  }
}
`;
let base,classes,binding,classpath,jars,sequence=0;
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:45000,maxBuffer:16*1024*1024,...options},(error,stdout,stderr)=>error?reject(Error(`${file}: ${error.message}\n${stdout}\n${stderr}`)):resolve(stdout)));
before(async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN,'An actual current toolchain is required; no mock or skip path');binding=readDLToolchain(process.env.EVOPILOT_TEST_DL_TOOLCHAIN);verifyDLToolchain(binding);
  assert.equal(binding.workerSourceDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/Worker.java',import.meta.url))));assert.equal(binding.dependencyLockDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/dependencies.json',import.meta.url))));
  jars=new Set(binding.runtimeFiles.filter(f=>/^dependencies\/owlapi-(distribution|parsers)-5\.5\.1\.jar$/.test(f.path)).map(f=>realpathSync(join(binding.root,f.path))));
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-turtle-locations-')));classes=join(base,'classes');mkdirSync(classes,{mode:0o700});
  const file=join(base,'TurtleLocationsProbe.java');writeFileSync(file,javaSource,{mode:0o600});classpath=javaClasspath(binding);await execute(join(binding.javaRoot,'bin/javac'),['-encoding','UTF-8','-cp',classpath,'-d',classes,file]);
});
after(()=>{try{if(binding)verifyDLToolchain(binding);}finally{if(base)rmSync(base,{recursive:true,force:true});}});
async function inspect(...cases){
  const file=join(base,'input-'+(++sequence)+'.json');writeFileSync(file,JSON.stringify(cases),{mode:0o600});
  const result=JSON.parse(await execute(join(binding.javaRoot,'bin/java'),['-Xmx512m','-cp',[classes,classpath].join(delimiter),'TurtleLocationsProbe',file]));
  for(const [name,path] of Object.entries(result.classes))assert.ok(name.startsWith('Located')?path===realpathSync(join(binding.root,'worker.jar')):jars.has(path),name+' class origin');return result.cases;
}
const prefix='@prefix : <urn:located:> .\n';
const triples=result=>result.locatedEvents.filter(e=>['RESOURCE','STRING','LANGUAGE','TYPED'].includes(e.kind));
function parity(result,content){
  assert.equal(result.originalStatus,'PARSED',JSON.stringify(result));assert.equal(result.locatedStatus,'PARSED',JSON.stringify(result));assert.equal(result.unlocatedStatus,'PARSED',JSON.stringify(result));assert.equal(result.returned,true);assert.equal(result.observerActive,0);assert.deepEqual(result.locatedEvents,result.originalEvents);assert.deepEqual(result.unlocatedEvents,result.locatedEvents);
  const sources=new Map(result.sources.map(s=>[s.id,s]));assert.equal(sources.size,result.sources.length);const contexts=new Map(result.contexts.map(c=>[c.id,c]));assert.equal(contexts.size,result.contexts.length);
  for(const s of sources.values()){assert.ok(s.id>0&&s.start>=0&&s.end>s.start&&s.end<=content.length);assert.equal(content.slice(s.start,s.end),s.text);assert.ok(!(s.start>0&&/[\uDC00-\uDFFF]/.test(content[s.start])));}
  assert.deepEqual(result.occurrences.map(o=>o.id),result.observedIds);assert.equal(result.occurrences.length,triples(result).length);
  for(const [index,o] of result.occurrences.entries()){
    const {kind:_,...event}=triples(result)[index];assert.deepEqual(o.triple,event);
    for(const term of [o.subject,o.predicate,o.object]){assert.ok(sources.has(term.sourceId));for(const id of term.contextIds)assert.ok(contexts.has(id));}
  }
  for(const c of contexts.values()){assert.ok(c.sourceId===0?['DOCUMENT','BUILTIN'].includes(c.kind):sources.has(c.sourceId));for(const id of c.dependencies)assert.ok(contexts.has(id));}
  return sources;
}

test('semicolon and comma events retain the exact inherited subject and predicate occurrences',async()=>{
  const subject=':s',predicate=':p',first=':one',second=':two',third='"雪😀"@zh';
  let content=prefix+'# fake :s :p :one ; :q "noise" .\r\n';const positions={};
  const add=(name,text)=>{positions[name]={start:content.length,end:content.length+text.length,text};content+=text;};
  add('subject',subject);content+=' ';add('predicate',predicate);content+=' ';add('first',first);content+=', ';add('second',second);content+=' ; ';add('next',':q');content+=' ';add('third',third);content+=' .';
  const [r]=await inspect({content});const sources=parity(r,content);assert.equal(r.occurrences.length,3);
  const span=(o,role)=>{const {start,end,text}=sources.get(o[role].sourceId);return {start,end,text};};
  for(const o of r.occurrences)assert.deepEqual(span(o,'subject'),positions.subject);
  for(const o of r.occurrences.slice(0,2))assert.deepEqual(span(o,'predicate'),positions.predicate);
  for(const [i,name] of ['first','second','third'].entries())assert.deepEqual(span(r.occurrences[i],'object'),positions[name]);
  assert.equal(r.occurrences[1].subject.inherited,true);assert.equal(r.occurrences[1].predicate.inherited,true);assert.equal(r.occurrences[2].subject.inherited,true);
});

test('nested blank property lists and collections retain generated triples and sealed real construct ranges',async()=>{
  const nested='[ :p ( :one [ :q "nested" ] ( :two ) ) ; :empty () ]',content=prefix+':s :has '+nested+' .\n_:shared :p :one . :s :shares _:shared .';
  const [r]=await inspect({content});const sources=parity(r,content);assert.ok(r.occurrences.length>10);
  const outer=r.occurrences.find(o=>o.triple.predicate==='urn:located:has');assert.equal(sources.get(outer.object.sourceId).text,nested);assert.equal(outer.object.generated,true);
  const generated=r.occurrences.filter(o=>o.generatedKind!==null);assert.ok(generated.length>0);assert.ok(generated.some(o=>o.triple.predicate==='http://www.w3.org/1999/02/22-rdf-syntax-ns#first'));assert.ok(generated.some(o=>o.triple.predicate==='http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'));
  assert.ok(r.sources.some(s=>s.kind==='COLLECTION'&&s.text==='()'));
});

test('raw source coordinates survive Unicode escapes, supplementary characters, lexer backup and buffer growth',async()=>{
  const slash=String.fromCharCode(92),lexical='"escaped '+slash+'" quote and '+slash+slash+' slash; '+slash+'u96EA '+slash+'U0001F600"';
  const long='"'+('a'.repeat(9000))+'😀\\nend"';
  const content=prefix+'@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\r\n:s :p '+lexical+' ; :long '+long+' ; :number 12.5e2 ; :typed "1"^^xsd:integer ; :bool true ; :iri <urn:escaped:\\u0041> .';
  const [r]=await inspect({content});const sources=parity(r,content);
  for(const [predicate,expected] of [['p',lexical],['long',long]]){const o=r.occurrences.find(o=>o.triple.predicate==='urn:located:'+predicate);assert.equal(sources.get(o.object.sourceId).text,expected);}
  assert.ok(r.sources.some(s=>s.text.includes('\\u0041')),'The original escape spelling must not be replaced with the decoded IRI');
});

test('base and prefix contexts preserve the original parser cache choices across redefinitions',async()=>{
  const content='@base <https://first.example/> .\n@prefix ex: <relative/> .\n<subject> ex:p <object> .\n@base <https://second.example/> .\n<subject> ex:p <object> .\n@prefix ex: <https://changed.example/> .\n<new> ex:p <fresh> .';
  const [r]=await inspect({content});parity(r,content);assert.equal(r.occurrences.length,3);
  assert.deepEqual(r.occurrences[1].triple,r.occurrences[0].triple,'Repeated IRI spelling preserves the actual upstream cache behavior');
  const contexts=new Map(r.contexts.map(c=>[c.id,c]));
  const dependencies=id=>{const c=contexts.get(id);return [c,...c.dependencies.flatMap(dependencies)];};
  const contextFor=term=>term.contextIds.flatMap(dependencies);
  assert.ok(contextFor(r.occurrences[1].subject).some(c=>c.resolved==='https://first.example/'));
  assert.ok(!contextFor(r.occurrences[1].subject).some(c=>c.resolved==='https://second.example/'));
  assert.equal(r.occurrences[2].triple.predicate,'https://changed.example/p');
});

test('IRIREF UCHAR correction decodes original escapes once in IRI, BASE and PREFIX without replacing raw spans',async()=>{
  const subject=String.raw`<urn:located:\u0041\U0001F600>`,directive=String.raw`@prefix ex: <urn:located:\u0042\U0001F600:> .`;
  const content=directive+'\n'+subject+' ex:p <urn:located:😀> .';
  const based=String.raw`@base <https://example.test/\u0041\U0001F600/> .
@prefix ex: <relative\u0042\U0001F600/> .
<sub\u006Aect> ex:p <object> .`;
  const results=await inspect({content},{content:based});
  for(const r of results){assert.equal(r.originalStatus,'PARSED');assert.equal(r.locatedStatus,'PARSED',JSON.stringify(r));assert.equal(r.unlocatedStatus,'PARSED');assert.deepEqual(r.unlocatedEvents,r.locatedEvents);assert.equal(r.returned,true);}
  const [r,b]=results;
  assert.deepEqual(triples(r).map(t=>[t.subject,t.predicate,t.resource]),[['urn:located:A😀','urn:located:B😀:p','urn:located:😀']]);
  assert.notDeepEqual(r.originalEvents,r.locatedEvents,'The independently retained original parser exposes its evidenced uppercase-U omission');
  assert.equal(r.sources.find(s=>s.id===r.occurrences[0].subject.sourceId).text,subject);assert.ok(r.sources.some(s=>s.kind==='PREFIX'&&s.text===directive));
  assert.deepEqual(triples(b).map(t=>[t.subject,t.predicate,t.resource]),[['https://example.test/A😀/subject','https://example.test/A😀/relativeB😀/p','https://example.test/A😀/object']]);
  assert.ok(b.contexts.some(c=>c.kind==='BASE'&&c.resolved==='https://example.test/A😀/'));assert.ok(b.contexts.some(c=>c.kind==='PREFIX'&&c.resolved==='https://example.test/A😀/relativeB😀/'));
  assert.ok(b.sources.some(s=>s.kind==='BASE'&&s.text===String.raw`@base <https://example.test/\u0041\U0001F600/> .`));
});

test('equivalent escaped and literal relative IRI spellings share the actual cache context without losing their original handles',async()=>{
  const content=String.raw`@base <https://first.example/> .
<\U00000073> <urn:located:p> <urn:located:o> .
@base <https://second.example/> .
<s> <urn:located:p> <urn:located:o> .`;
  const [r]=await inspect({content});assert.equal(r.locatedStatus,'PARSED',JSON.stringify(r));assert.equal(r.unlocatedStatus,'PARSED');assert.deepEqual(r.unlocatedEvents,r.locatedEvents);
  assert.deepEqual(triples(r).map(t=>t.subject),['https://first.example/s','https://first.example/s']);
  assert.deepEqual(r.occurrences.map(o=>r.sources.find(s=>s.id===o.subject.sourceId).text),[String.raw`<\U00000073>`,'<s>']);
  const contexts=new Map(r.contexts.map(c=>[c.id,c]));
  for(const o of r.occurrences){const deps=o.subject.contextIds.map(id=>contexts.get(id));assert.ok(deps.some(c=>c.resolved==='https://first.example/'));assert.ok(!deps.some(c=>c.resolved==='https://second.example/'));}
});

test('malformed IRI escapes, non-scalars and escaped illegal IRI characters fail in both corrected parser modes',async()=>{
  const invalid=[String.raw`\U00110000`,String.raw`\UFFFFFFFF`,String.raw`\uD800`,String.raw`\uDFFF`,String.raw`\U0000D800`,String.raw`\uD83D\uDE00`,String.raw`\uu0041`,String.raw`\U0001FX00`,String.raw`\U1234`,String.raw`\q`,String.raw`\\u0041`,String.raw`\u005Cu0041`,String.raw`\U0000005Cu0041`,String.raw`\U00000020`,String.raw`\U00000000`,String.raw`\U0000003C`,String.raw`\U0000003E`,String.raw`\U00000022`,String.raw`\U0000007B`,String.raw`\U0000007D`,String.raw`\U0000007C`,String.raw`\U0000005E`,String.raw`\U00000060`];
  const results=await inspect(...invalid.map(value=>({content:'<urn:located:'+value+'> <urn:located:p> <urn:located:o> .'})));
  for(const [i,r] of results.entries()){assert.equal(r.locatedStatus,'PARSE_ERROR',invalid[i]+' '+JSON.stringify(r));assert.equal(r.unlocatedStatus,'PARSE_ERROR',invalid[i]);assert.equal(r.returned,false);assert.equal(r.occurrences,undefined);}
});

test('IRI Unicode character classes preserve legal ucschar and constrain private-use characters to query',async()=>{
  const legal=[String.raw`urn:located:\u00A0`,String.raw`urn:located:\u2028\u2029`,String.raw`urn:located:?q=\uE000`,String.raw`urn:located:?q=\U000F0000\U00100000`];
  const illegal=[String.raw`urn:located:\u0085`,String.raw`urn:located:\uFDD0`,String.raw`urn:located:\U0001FFFE`,String.raw`urn:located:\U000E0001`,String.raw`urn:located:\U0010FFFF`,String.raw`urn:located:\uE000`,String.raw`urn:located:#fragment?\uE000`,String.raw`urn:located:?q=ok#\uE000`];
  const results=await inspect(...[...legal,...illegal].map(value=>({content:'<'+value+'> <urn:located:p> <urn:located:o> .'})));
  for(const [i,r] of results.entries()){const expected=i<legal.length?'PARSED':'PARSE_ERROR';assert.equal(r.locatedStatus,expected,JSON.stringify(r));assert.equal(r.unlocatedStatus,expected);if(expected==='PARSED')assert.deepEqual(r.unlocatedEvents,r.locatedEvents);else assert.equal(r.returned,false);}
  assert.equal(triples(results[0])[0].subject,'urn:located:\u00A0');assert.equal(triples(results[1])[0].subject,'urn:located:\u2028\u2029');
  assert.equal(triples(results[2])[0].subject,'urn:located:?q=\uE000');assert.equal(triples(results[3])[0].subject,'urn:located:?q='+String.fromCodePoint(0xF0000,0x100000));
});

test('ordinary parsing does not acquire located occurrence or directive capacity limits',async()=>{
  const count=200001,directives=10001,content=prefix.repeat(directives)+':s :p :o .\n'.repeat(count);
  const [r]=await inspect({content,countOnly:true});
  assert.deepEqual(r.unlocatedCounts,r.originalCounts);assert.deepEqual(r.unlocatedCounts,{resources:count,plain:0,languages:0,datatypes:0,prefixes:directives,bases:0,ends:1});
});

test('upstream builtin prefixes retain explicit context identities without fabricated source spans',async()=>{
  const content=prefix+':A rdf:type owl:Class . :A rdfs:label "A"^^xsd:string . :A xml:lang "en" .';
  const [r]=await inspect({content});parity(r,content);const contexts=new Map(r.contexts.map(c=>[c.id,c]));
  const seen=new Set();for(const o of r.occurrences)for(const t of [o.subject,o.predicate,o.object])for(const id of t.contextIds){const c=contexts.get(id);if(c.kind==='BUILTIN'){assert.equal(c.sourceId,0);seen.add(c.prefixName);}}
  for(const name of ['rdf:','owl:','rdfs:','xsd:','xml:'])assert.ok(seen.has(name),name+' actual builtin dependency');
});

test('duplicate triples remain distinct occurrences and limits or malformed input return no partial result',async()=>{
  const content=prefix+':s :p :o .\r:s :p :o .\n:s :p :o .';
  const [ok,limited,bad]=await inspect({content,limit:3},{content,limit:2},{content:prefix+':s :p :o . :s :q [ :p "unfinished'});
  parity(ok,content);assert.equal(ok.occurrences.length,3);assert.equal(new Set(ok.occurrences.map(o=>o.id)).size,3);assert.deepEqual(ok.occurrences.map(o=>o.triple),Array(3).fill(ok.occurrences[0].triple));
  assert.equal(limited.originalStatus,'PARSED');assert.equal(limited.locatedStatus,'LIMIT');assert.equal(limited.returned,false);assert.equal(limited.sources,undefined);
  assert.equal(bad.originalStatus,'PARSE_ERROR');assert.equal(bad.locatedStatus,'PARSE_ERROR');assert.equal(bad.returned,false);assert.equal(bad.observerActive,0);
});
