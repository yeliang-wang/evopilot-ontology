import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {execFile} from 'node:child_process';
import {readDLToolchain,verifyDLToolchain,javaClasspath} from '../../dist/reasoning/toolchain.js';
import {hashBytes} from '../../dist/standalone/validation.js';

// Real SAX/RDF grammar comparison. Original classes remain an independent
// baseline; corrected base/IRI cases use fixed expected semantic IRIs instead.
const javaSource=String.raw`
import java.io.*;
import java.nio.file.*;
import java.util.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.semanticweb.owlapi.model.*;
import org.semanticweb.owlapi.rdf.rdfxml.parser.*;
import org.xml.sax.*;

public final class XMLLocationsProbe {
  static final ObjectMapper JSON=new ObjectMapper();
  static final IRI BASE=IRI.create("https://example.test/source/document");
  static final class Recorder implements RDFConsumer {
    final ArrayNode events=JSON.createArrayNode();final Map<String,String> anonymous=new LinkedHashMap<>();final boolean retain;int statements;
    Recorder(){this(true);}Recorder(boolean retain){this.retain=retain;}
    String iri(String s){if(s==null)return null;return NodeID.isAnonymousNodeIRI(s)||NodeID.isAnonymousNodeID(s)?anonymous.computeIfAbsent(s,k->"_:observed"+(anonymous.size()+1)):s;}
    void row(String kind,String s,String p,String o,String literal,String language,String datatype){statements++;if(!retain)return;var r=events.addObject();r.put("kind",kind);r.put("subject",iri(s));r.put("predicate",iri(p));r.put("resource",iri(o));r.put("literal",literal);r.put("language",language);r.put("datatype",iri(datatype));}
    public void startModel(IRI iri){if(retain)events.addObject().put("kind","START").put("iri",iri.toString());}
    public void endModel(){if(retain)events.addObject().put("kind","END");}
    public void logicalURI(IRI iri){if(retain)events.addObject().put("kind","LOGICAL").put("iri",iri.toString());}
    public void includeModel(String logical,String physical){throw new IllegalStateException("No external include permitted in fixture");}
    public void statementWithResourceValue(String s,String p,String o){row("RESOURCE_STRING",s,p,o,null,null,null);}
    public void statementWithResourceValue(IRI s,IRI p,IRI o){row("RESOURCE_IRI",s.toString(),p.toString(),o.toString(),null,null,null);}
    public void statementWithLiteralValue(String s,String p,String o,String l,String d){row("LITERAL_STRING",s,p,null,o,l,d);}
    public void statementWithLiteralValue(IRI s,IRI p,String o,String l,IRI d){row("LITERAL_IRI",s.toString(),p.toString(),null,o,l,d==null?null:d.toString());}
    public IRI remapIRI(IRI iri){return iri;}
    public String remapOnlyIfRemapped(String iri){return iri;}
    public void addPrefix(String name,String value){if(retain)events.addObject().put("kind","PREFIX").put("name",name).put("value",value);}
    public OWLOntologyLoaderConfiguration getConfiguration(){return new OWLOntologyLoaderConfiguration().setEntityExpansionLimit("1000");}
  }
  static ObjectNode term(LocatedRDFXMLParser.TermSource value){var r=JSON.createObjectNode();r.put("sourceSetId",value.sourceSetId());r.put("inherited",value.inherited());r.put("generated",value.generated());r.set("contextIds",JSON.valueToTree(value.contextIds()));return r;}
  static void fatal(Throwable error){if(error instanceof VirtualMachineError e)throw e;if(error instanceof ThreadDeath e)throw e;}
  static ObjectNode run(JsonNode input)throws Exception{
    String content=input.path("content").asText();IRI base=IRI.create(input.path("documentIri").asText(BASE.toString()));var out=JSON.createObjectNode();var old=new Recorder();var ordinary=new Recorder();
    if(input.path("countOnly").asBoolean(false)){var counter=new Recorder(false);new LocatedRDFXMLParser(content,base).parseUnlocated(counter);out.put("count",counter.statements);return out;}
    if(!input.path("skipOriginal").asBoolean(false))try{var source=new InputSource(new StringReader(content));source.setSystemId(base.toString());new RDFParser().parse(source,old);out.put("originalStatus","PARSED");}catch(Throwable e){fatal(e);out.put("originalStatus","REFUSED");out.put("originalError",e.toString());}
    out.set("originalEvents",old.events);
    try{new LocatedRDFXMLParser(content,base).parseUnlocated(ordinary);out.put("ordinaryStatus","PARSED");}catch(Throwable e){fatal(e);out.put("ordinaryStatus","REFUSED");out.put("ordinaryError",e.toString());}
    out.set("ordinaryEvents",ordinary.events);
    var sink=new Recorder();var ids=new ArrayList<Integer>();int[] active={0};LocatedRDFXMLParser.Result result=null;
    var budget=new RDFProvenance.Budget(System.nanoTime()+(input.path("expired").asBoolean(false)?-1:30_000_000_000L));
    if(input.path("precharged").asBoolean(false))budget.sourceRecords(1_600_000);
    try{
      var parser=new LocatedRDFXMLParser(content,base,new LocatedRDFXMLParser.OccurrenceObserver(){
        public void beforeTriple(int id){if(id<=0||active[0]!=0)throw new IllegalStateException("Unbound/nested actual RDF callback");active[0]=id;ids.add(id);}
        public void afterTriple(){if(active[0]==0)throw new IllegalStateException("Missing RDF callback owner");active[0]=0;}
      },budget);
      result=parser.parse(sink);out.put("locatedStatus","PARSED");
    }catch(RDFProvenance.TimeoutException e){out.put("locatedStatus","TIMEOUT");}
    catch(RDFProvenance.LimitException|LocatedRDFXMLParser.LimitException e){out.put("locatedStatus","LIMIT");}
    catch(Throwable e){fatal(e);out.put("locatedStatus","REFUSED");out.put("locatedError",e.toString());var text=new StringWriter();e.printStackTrace(new PrintWriter(text));out.put("stack",text.toString());}
    out.set("locatedEvents",sink.events);out.set("observerIds",JSON.valueToTree(ids));out.put("observerActive",active[0]);out.put("returned",result!=null);
    if(result!=null){
      var sources=out.putArray("sources");for(var s:result.sources()){var r=sources.addObject();r.put("id",s.id());r.put("kind",s.kind());r.put("start",s.span().start());r.put("end",s.span().end());r.put("text",content.substring(s.span().start(),s.span().end()));}
      out.set("sourceSets",JSON.valueToTree(result.sourceSets()));out.set("contexts",JSON.valueToTree(result.contexts()));
      var rows=out.putArray("occurrences");for(var o:result.occurrences()){var r=rows.addObject();r.put("id",o.id());r.put("generatedKind",o.generatedKind());r.set("subject",term(o.subject()));r.set("predicate",term(o.predicate()));r.set("object",term(o.object()));var t=o.triple();var tuple=r.putObject("triple");tuple.put("subject",sink.iri(t.subject().toString()));tuple.put("predicate",sink.iri(t.predicate().toString()));tuple.put("resource",t.resourceObject()==null?null:sink.iri(t.resourceObject().toString()));tuple.put("literal",t.lexicalObject());tuple.put("language",t.language());tuple.put("datatype",t.datatype()==null?null:sink.iri(t.datatype().toString()));}
      boolean immutable=false;try{result.occurrences().clear();}catch(UnsupportedOperationException e){immutable=true;}out.put("immutable",immutable);
    }
    return out;
  }
  static String origin(Class<?> c)throws Exception{return Path.of(c.getProtectionDomain().getCodeSource().getLocation().toURI()).toRealPath().toString();}
  public static void main(String[] args)throws Exception{
    var input=JSON.readTree(Files.readAllBytes(Path.of(args[0])));var out=JSON.createObjectNode();var classes=out.putObject("classes");
    for(String name:List.of("RDFParser","StartRDF","LocatedRDFXMLParser","LocatedRDFXMLSyntaxParser","RDFXMLRawScanner","LocatedXMLStartRDF","LocatedXMLParseTypeCollectionElement"))classes.put(name,origin(Class.forName("org.semanticweb.owlapi.rdf.rdfxml.parser."+name)));
    var rows=out.putArray("cases");for(var item:input)rows.add(run(item));System.out.println(JSON.writeValueAsString(out));
  }
}
`;
let root,classes,binding,classpath,jars,sequence=0;
const execute=(file,args)=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:24*1024*1024},(error,stdout,stderr)=>error?reject(Error(`${file}: ${error.message}\n${stdout}\n${stderr}`)):resolve(stdout)));
before(async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN,'An actual current DL toolchain is required; no mock/skip path');binding=readDLToolchain(process.env.EVOPILOT_TEST_DL_TOOLCHAIN);verifyDLToolchain(binding);
  assert.equal(binding.workerSourceDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/Worker.java',import.meta.url))));assert.equal(binding.dependencyLockDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/dependencies.json',import.meta.url))));
  jars=new Set(binding.runtimeFiles.filter(f=>/^dependencies\/owlapi-(distribution|parsers)-5\.5\.1\.jar$/.test(f.path)).map(f=>realpathSync(join(binding.root,f.path))));
  root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-xml-locations-')));classes=join(root,'classes');mkdirSync(classes,{mode:0o700});classpath=javaClasspath(binding);
  const file=join(root,'XMLLocationsProbe.java');writeFileSync(file,javaSource,{mode:0o600});await execute(join(binding.javaRoot,'bin/javac'),['-encoding','UTF-8','-cp',classpath,'-d',classes,file]);
});
after(()=>{try{if(binding)verifyDLToolchain(binding);}finally{if(root)rmSync(root,{recursive:true,force:true});}});
async function inspect(...inputs){const path=join(root,'input-'+(++sequence)+'.json');writeFileSync(path,JSON.stringify(inputs),{mode:0o600});const result=JSON.parse(await execute(join(binding.javaRoot,'bin/java'),['-Xmx768m','-cp',[classes,classpath].join(delimiter),'XMLLocationsProbe',path]));for(const [name,path] of Object.entries(result.classes))assert.ok(name==='RDFParser'||name==='StartRDF'?jars.has(path):path===realpathSync(join(binding.root,'worker.jar')),name+' must come from its independently identified jar');return result.cases;}
const RDF='http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const wrap=(body,attrs='',dtd='')=>`${dtd}<rdf:RDF xmlns:rdf="${RDF}" xmlns:ex="urn:example:" ${attrs}>${body}</rdf:RDF>`;
const statements=r=>r.locatedEvents.filter(e=>e.kind.startsWith('RESOURCE_')||e.kind.startsWith('LITERAL_'));
function indexed(result,content,{original=true,reificationCorrection=false}={}){
  assert.equal(result.locatedStatus,'PARSED',JSON.stringify(result));assert.equal(result.ordinaryStatus,'PARSED',JSON.stringify(result));assert.equal(result.returned,true);assert.equal(result.immutable,true);assert.equal(result.observerActive,0);
  assert.deepEqual(result.locatedEvents,result.ordinaryEvents);if(original){assert.equal(result.originalStatus,'PARSED',JSON.stringify(result));
    if(reificationCorrection){
      // Pinned RDFConstants.RDF_STATEMENT is the erroneous lowercase term.
      // Assert that specific old defect independently; all other event fields
      // and ordering must still be identical. The new normative term is fixed.
      const old=result.originalEvents.filter(e=>e.predicate===RDF+'type'&&e.resource===RDF+'statement');assert.ok(old.length>0);
      assert.equal(result.locatedEvents.filter(e=>e.predicate===RDF+'type'&&e.resource===RDF+'Statement').length,old.length);
      assert.deepEqual(result.locatedEvents,result.originalEvents.map(e=>e.predicate===RDF+'type'&&e.resource===RDF+'statement'?{...e,resource:RDF+'Statement'}:e));
    }else assert.deepEqual(result.locatedEvents,result.originalEvents);
  }
  const sources=new Map(result.sources.map(s=>[s.id,s])),sets=new Map(result.sourceSets.map(s=>[s.id,s.sourceIds])),contexts=new Map(result.contexts.map(c=>[c.id,c]));
  assert.equal(sources.size,result.sources.length);assert.equal(sets.size,result.sourceSets.length);assert.equal(contexts.size,result.contexts.length);
  for(const s of sources.values()){assert.ok(s.id>0&&s.start>=0&&s.end>s.start&&s.end<=content.length);assert.equal(s.text,content.slice(s.start,s.end));assert.ok(!/[\uDC00-\uDFFF]/.test(content[s.start]));assert.ok(s.end===content.length||!/[\uDC00-\uDFFF]/.test(content[s.end]));}
  for(const ids of sets.values()){assert.ok(ids.length>0);assert.deepEqual(ids,[...new Set(ids)].sort((a,b)=>a-b));for(const id of ids)assert.ok(sources.has(id));}
  for(const c of contexts.values()){assert.deepEqual(c.dependencyContextIds,[...new Set(c.dependencyContextIds)].sort((a,b)=>a-b));for(const id of c.dependencyContextIds)assert.ok(id<c.id&&contexts.has(id));assert.ok(c.sourceSetId>0?sets.has(c.sourceSetId):['DOCUMENT','BUILTIN'].includes(c.kind));}
  assert.deepEqual(result.observerIds,result.occurrences.map(o=>o.id));assert.equal(result.occurrences.length,statements(result).length);
  for(const [i,o] of result.occurrences.entries()){
    const {kind,...tuple}=statements(result)[i];assert.deepEqual(o.triple,tuple);for(const term of [o.subject,o.predicate,o.object]){assert.ok(sets.has(term.sourceSetId));for(const id of term.contextIds)assert.ok(contexts.has(id));}
  }
  return {sources,sets,contexts};
}
function fragments(result,term,{closure=false}={}){const sources=new Map(result.sources.map(s=>[s.id,s])),sets=new Map(result.sourceSets.map(s=>[s.id,s.sourceIds])),contexts=new Map(result.contexts.map(c=>[c.id,c]));const ids=new Set(sets.get(term.sourceSetId)),seen=new Set();function visit(id){if(seen.has(id))return;seen.add(id);const c=contexts.get(id);if(c.sourceSetId)for(const source of sets.get(c.sourceSetId))ids.add(source);for(const dep of c.dependencyContextIds)visit(dep);}if(closure)for(const id of term.contextIds)visit(id);return [...ids].map(id=>sources.get(id).text);}
function contextKinds(result,term){const contexts=new Map(result.contexts.map(c=>[c.id,c])),seen=new Set(),kinds=new Set();function visit(id){if(seen.has(id))return;seen.add(id);const c=contexts.get(id);kinds.add(c.kind);for(const dep of c.dependencyContextIds)visit(dep);}for(const id of term.contextIds)visit(id);return kinds;}

test('actual XML typed nodes, property attributes, shared nodeID and reification have individual callback origins',async()=>{
  const content=wrap(`<ex:Service rdf:about="urn:service" ex:label="支付😀" xml:lang="zh"><ex:uses rdf:nodeID="shared" rdf:ID="use"/><ex:uses rdf:nodeID="shared"/></ex:Service><rdf:Description rdf:nodeID="shared" ex:owner="team"/><ex:Unrelated rdf:about="urn:unrelated"/>`);
  const [r]=await inspect({content});indexed(r,content,{reificationCorrection:true});const uses=r.occurrences.filter(o=>o.triple.predicate==='urn:example:uses');assert.equal(uses.length,2);assert.equal(uses[0].triple.resource,uses[1].triple.resource);assert.notEqual(uses[0].object.sourceSetId,uses[1].object.sourceSetId);
  assert.deepEqual(fragments(r,uses[0].subject),['rdf:about="urn:service"']);assert.deepEqual(fragments(r,uses[0].object),['rdf:nodeID="shared"']);assert.ok(!fragments(r,uses[0].subject,{closure:true}).some(s=>s.includes('Unrelated')));
  assert.equal(r.occurrences.filter(o=>o.generatedKind==='REIFICATION').length,4);assert.ok(r.occurrences.some(o=>o.generatedKind==='TYPED_NODE'));assert.ok(r.occurrences.some(o=>o.generatedKind==='PROPERTY_ATTRIBUTE'&&o.triple.literal==='支付😀'));
});

test('parseType Resource and Collection retain generated structure and distinct list member sources',async()=>{
  const content=wrap(`<rdf:Description rdf:about="urn:service"><ex:configuration rdf:parseType="Resource"><ex:name>production</ex:name></ex:configuration><ex:dependencies rdf:parseType="Collection"><rdf:Description rdf:about="urn:a"/><rdf:Description rdf:about="urn:b"/></ex:dependencies><ex:empty rdf:parseType="Collection"/></rdf:Description>`);
  const [r]=await inspect({content});indexed(r,content,{original:false});assert.deepEqual(r.locatedEvents,r.originalEvents.filter(e=>!(e.predicate===RDF+'type'&&e.resource===RDF+'List')));assert.equal(r.occurrences.filter(o=>o.generatedKind==='COLLECTION_TYPE').length,0);const first=r.occurrences.filter(o=>o.triple.predicate===RDF+'first');assert.deepEqual(first.map(o=>o.triple.resource),['urn:a','urn:b']);assert.deepEqual(first.map(o=>fragments(r,o.object)),[['rdf:about="urn:a"'],['rdf:about="urn:b"']]);assert.equal(r.occurrences.filter(o=>o.generatedKind==='COLLECTION_REST').length,2);assert.ok(r.occurrences.some(o=>o.generatedKind==='PARSE_TYPE_RESOURCE'));assert.ok(r.occurrences.some(o=>o.triple.predicate==='urn:example:empty'&&o.triple.resource===RDF+'nil'));
});

test('rdf li ordering and explicit reification retain source causes; retired bagID syntax is refused',async()=>{
  const content=wrap(`<rdf:Bag rdf:about="urn:bag"><rdf:li rdf:ID="first" rdf:resource="urn:first"/><ex:unrelated rdf:resource="urn:ignored"/><rdf:li rdf:ID="second" rdf:resource="urn:second"/></rdf:Bag>`);
  const [r]=await inspect({content});indexed(r,content,{reificationCorrection:true});const second=r.occurrences.find(o=>o.triple.subject==='urn:bag'&&o.triple.predicate===RDF+'_2');assert.ok(second);assert.ok(contextKinds(r,second.predicate).has('RDF_LI_ORDER'));const spans=fragments(r,second.predicate,{closure:true});assert.ok(spans.filter(s=>s==='rdf:li').length>=1);assert.ok(!spans.some(s=>s.includes('unrelated')));assert.equal(r.occurrences.filter(o=>o.generatedKind==='REIFICATION').length,8);
  const [retired]=await inspect({content:wrap('<rdf:Bag rdf:about="urn:bag" rdf:bagID="record"><rdf:li rdf:resource="urn:first"/></rdf:Bag>')});assert.equal(retired.locatedStatus,'REFUSED');assert.equal(retired.ordinaryStatus,'REFUSED');assert.equal(retired.returned,false);
});

test('internal general entities preserve separate use/declaration spans for text and generated markup',async()=>{
  const dtd=`<!DOCTYPE rdf:RDF [<!ENTITY label "财务&#x1F600;"><!ENTITY member '<ex:link rdf:resource="urn:target"/>'>]>`;
  const content=wrap(`<rdf:Description rdf:about="urn:service"><ex:name>A&label;B</ex:name>&member;&member;</rdf:Description>`,'',dtd);
  const [r]=await inspect({content});indexed(r,content);const name=r.occurrences.find(o=>o.triple.predicate==='urn:example:name');assert.equal(name.triple.literal,'A财务😀B');const spans=fragments(r,name.object,{closure:true});assert.ok(spans.some(s=>s==='&label;'));assert.ok(spans.some(s=>s.includes('<!ENTITY label')));assert.ok(contextKinds(r,name.object).has('ENTITY_REFERENCE'));assert.ok(contextKinds(r,name.object).has('ENTITY_DECLARATION'));
  const links=r.occurrences.filter(o=>o.triple.predicate==='urn:example:link');assert.equal(links.length,2);assert.ok(links.every(o=>o.generatedKind==='ENTITY_EXPANSION'));assert.notDeepEqual(links[0].predicate.contextIds,links[1].predicate.contextIds);for(const link of links){const f=fragments(r,link.predicate,{closure:true});assert.ok(f.some(s=>s==='&member;'));assert.ok(f.some(s=>s.includes('<!ENTITY member')));}
});

test('parameter entity DTD declarations and normalized default attributes form explicit source context chains',async()=>{
  const dtd=`<!DOCTYPE rdf:RDF [<!ENTITY target "urn:default"><!ENTITY % attrs '<!ATTLIST ex:uses rdf:resource CDATA "&target;">'>%attrs;<!ATTLIST rdf:Description ex:tags NMTOKENS "  alpha   beta  ">]>`;
  const content=wrap(`<rdf:Description rdf:about="urn:service"><ex:uses/></rdf:Description>`,'',dtd);
  const [r]=await inspect({content});indexed(r,content);const use=r.occurrences.find(o=>o.triple.predicate==='urn:example:uses');assert.equal(use.triple.resource,'urn:default');const kinds=contextKinds(r,use.object);for(const kind of ['DTD_ATTRIBUTE_DEFAULT','DTD_ATTRIBUTE_DECLARATION','ENTITY_REFERENCE','ENTITY_DECLARATION'])assert.ok(kinds.has(kind),kind);assert.ok(fragments(r,use.object,{closure:true}).some(s=>s==='%attrs;'));assert.ok(r.occurrences.some(o=>o.triple.predicate==='urn:example:tags'&&o.triple.literal==='alpha beta'));
  const duplicate=wrap(`<rdf:Description rdf:about="urn:s"><ex:p>&name;</ex:p><ex:uses/></rdf:Description>`,'',`<!DOCTYPE rdf:RDF [<!ENTITY name "first"><!ENTITY name "second"><!ENTITY % attrs '<!ATTLIST ex:uses rdf:resource CDATA "urn:first">'><!ENTITY % attrs '<!ATTLIST ex:uses rdf:resource CDATA "urn:second">'>%attrs;]>`);
  const [first]=await inspect({content:duplicate});indexed(first,duplicate);assert.equal(first.occurrences.find(o=>o.triple.predicate==='urn:example:p').triple.literal,'first');assert.equal(first.occurrences.find(o=>o.triple.predicate==='urn:example:uses').triple.resource,'urn:first');
  assert.ok(!fragments(first,first.occurrences.find(o=>o.triple.predicate==='urn:example:p').object,{closure:true}).some(s=>s.includes('second')));
});

test('external EOL normalization runs once; entity character-reference CR and attribute whitespace retain XML semantics',async()=>{
  const dtd=`<!DOCTYPE rdf:RDF [<!ENTITY cr "&#xD;"><!ENTITY pair "&#xD;&#xA;">]>`;
  const content=wrap(`<rdf:Description rdf:about="urn:s" ex:pair="&pair;" ex:direct="&#xD;&#xA;"><ex:p>A&cr;B</ex:p><ex:raw>A\r\nB\rC</ex:raw></rdf:Description>`,'',dtd);
  const [r]=await inspect({content});indexed(r,content,{original:false});
  // The pinned JDK entity scanner changes internal replacement CR to LF;
  // this baseline defect is recorded, while the independent XML oracle below
  // requires the mature semantic provider to retain the referenced CR.
  assert.equal(r.originalStatus,'PARSED');assert.equal(r.originalEvents.find(e=>e.predicate==='urn:example:p').literal,'A\nB');
  const literal=name=>r.occurrences.find(o=>o.triple.predicate==='urn:example:'+name).triple.literal;
  assert.equal(literal('pair'),'  ');assert.equal(literal('direct'),'\r\n');assert.equal(literal('p'),'A\rB');assert.equal(literal('raw'),'A\nB\nC');
  const cr=r.occurrences.find(o=>o.triple.predicate==='urn:example:p');assert.ok(fragments(r,cr.object,{closure:true}).some(s=>s==='&cr;'));assert.ok(fragments(r,cr.object,{closure:true}).some(s=>s.includes('&#xD;')));
});

test('XML literal, CDATA and raw non-BMP text retain original syntax rather than serializer output',async()=>{
  const content=wrap(`<rdf:Description rdf:about="urn:service"><ex:rich rdf:parseType="Literal"><h:em xmlns:h="urn:html:">财务😀 &amp; A<![CDATA[<raw>]]></h:em></ex:rich><ex:plain xml:lang="zh">A\r\n<![CDATA[😀<&]]>&#x1F600;</ex:plain></rdf:Description>`,'xml:lang="en"');
  const [r]=await inspect({content});indexed(r,content);const rich=r.occurrences.find(o=>o.triple.predicate==='urn:example:rich');assert.equal(rich.generatedKind,'PARSE_TYPE_LITERAL');assert.equal(rich.triple.datatype,RDF+'XMLLiteral');assert.equal(rich.triple.language,'en');assert.ok(fragments(r,rich.object).some(s=>s.includes('<![CDATA[<raw>]]>')));const plain=r.occurrences.find(o=>o.triple.predicate==='urn:example:plain');assert.equal(plain.triple.literal,'A\n😀<&😀');assert.equal(plain.triple.language,'zh');assert.ok(r.sources.some(s=>s.kind==='CDATA'&&s.text==='<![CDATA[😀<&]]>'));assert.ok(contextKinds(r,rich.object).has('NAMESPACE'));
});

test('corrected XML base scopes and relative datatypes use exact current contexts instead of stale original cache',async()=>{
  const fragmentInput=wrap('<rdf:Description rdf:about="#s"><ex:p rdf:resource="#o"/></rdf:Description>');
  for(const documentIri of ['urn:test:source','model:/folder/source']){
    const [r]=await inspect({content:fragmentInput,documentIri});indexed(r,fragmentInput,{original:false});
    const o=r.occurrences.find(o=>o.triple.predicate==='urn:example:p');assert.equal(o.triple.subject,documentIri+'#s');assert.equal(o.triple.resource,documentIri+'#o');
    assert.ok(r.contexts.some(c=>c.kind==='DOCUMENT'&&c.resolved===documentIri));
  }
  const content=wrap(`<rdf:Description rdf:about="s"><ex:one rdf:resource="target"/><ex:inner xml:base="nested/"><rdf:Description rdf:about="s"><ex:two rdf:resource="target"/><ex:typed rdf:datatype="kind">v</ex:typed></rdf:Description></ex:inner><ex:three rdf:resource="target"/></rdf:Description>`,'xml:base="https://example.test/root/"');
  const [r]=await inspect({content});indexed(r,content,{original:false});for(const [p,value] of [['one','https://example.test/root/target'],['two','https://example.test/root/nested/target'],['three','https://example.test/root/target']])assert.equal(r.occurrences.find(o=>o.triple.predicate==='urn:example:'+p).triple.resource,value);assert.equal(r.occurrences.find(o=>o.triple.predicate==='urn:example:typed').triple.datatype,'https://example.test/root/nested/kind');const three=r.occurrences.find(o=>o.triple.predicate==='urn:example:three');assert.ok(!fragments(r,three.object,{closure:true}).some(s=>s==='xml:base="nested/"'));assert.ok(r.contexts.some(c=>c.kind==='XML_BASE'&&c.resolved==='https://example.test/root/nested/'));
});

test('implicit xml namespace, explicit default namespace and language reset have honest context identities',async()=>{
  const content=wrap(`<Description xmlns="${RDF}" rdf:about="urn:service"><ex:a xml:lang="fr">é</ex:a><ex:b xml:lang="">x</ex:b></Description>`,'xml:lang="en"');
  const [r]=await inspect({content});indexed(r,content);assert.ok(r.contexts.some(c=>c.kind==='BUILTIN'&&c.name==='xml'&&c.sourceSetId===0));assert.ok(r.contexts.some(c=>c.kind==='DOCUMENT'&&c.sourceSetId===0));assert.ok(r.contexts.some(c=>c.kind==='NAMESPACE'&&c.name===''&&c.resolved===RDF));assert.equal(r.occurrences.find(o=>o.triple.predicate==='urn:example:b').triple.language,'');
});

test('malformed, external and unresolved source inputs never return a partial successful location table',async()=>{
  const inputs=[wrap('<rdf:Description rdf:about="urn:s"><ex:p>&missing;</ex:p></rdf:Description>'),wrap('<rdf:Description rdf:about="urn:s"><ex:p></rdf:Description>'),wrap('<rdf:Description rdf:about="urn:s">&loop;</rdf:Description>','',`<!DOCTYPE rdf:RDF [<!ENTITY loop "&loop;">]>`),wrap('<rdf:Description rdf:about="urn:s"/>','',`<!DOCTYPE rdf:RDF SYSTEM "file:///must-not-open">`),wrap('<rdf:Description rdf:about="urn:s"><ex:p>&external;</ex:p></rdf:Description>','',`<!DOCTYPE rdf:RDF [<!ENTITY external SYSTEM "file:///must-not-open">]>`),wrap('<rdf:Description rdf:about="urn:s"><ex:p rdf:resource="http://host/%ZZ"/></rdf:Description>')];
  inputs.push(wrap('<rdf:Description rdf:about="urn:s"><ex:p>'+'&e;'.repeat(1001)+'</ex:p></rdf:Description>','',`<!DOCTYPE rdf:RDF [<!ENTITY e "v">]>`));
  inputs.push(wrap('<rdf:Description rdf:about="urn:s"><ex:p>'+'&e;'.repeat(1000)+'</ex:p></rdf:Description>','',`<!DOCTYPE rdf:RDF [<!ENTITY e "${'x'.repeat(9000)}">]>`));
  inputs.push(wrap('<rdf:Description rdf:about="urn:s"><ex:p rdf:parseType="Literal">'+'<x>'.repeat(255)+'</x>'.repeat(255)+'</ex:p></rdf:Description>'));
  inputs.push(wrap('<rdf:Description rdf:about="urn:s"/>','',`<!DOCTYPE rdf:RDF [<!ENTITY % external SYSTEM "file:///must-not-open">%external;]>`));
  const results=await inspect(...inputs.map(content=>({content,skipOriginal:true})));for(const r of results){assert.equal(r.returned,false);assert.notEqual(r.locatedStatus,'PARSED');assert.equal(r.ordinaryStatus,'REFUSED');assert.equal(r.observerActive,0);}
  const xml11=['plain','NEL\u0085andLS\u2028','&#x1;'].map(value=>'<?xml version="1.1"?>'+wrap('<rdf:Description rdf:about="urn:s"><ex:p>'+value+'</ex:p></rdf:Description>'));
  const versions=await inspect(...xml11.map(content=>({content,skipOriginal:true})));for(const r of versions){assert.equal(r.returned,false);assert.equal(r.ordinaryStatus,'REFUSED');assert.equal(r.locatedStatus,'REFUSED');assert.match(r.ordinaryError,/requires XML 1\.0/);assert.match(r.locatedError,/requires XML 1\.0/);assert.equal(r.observerIds.length,0);}
  const text='财务😀 NEL\u0085LS\u2028';const xml10=wrap('<rdf:Description rdf:about="urn:s"><ex:p>'+text+'</ex:p></rdf:Description>');
  for(const content of [xml10,'<?xml version="1.0"?>'+xml10]){const [r]=await inspect({content});indexed(r,content);assert.equal(r.occurrences[0].triple.literal,text);}
});

test('located XML shares the original task deadline and source budget; ordinary parsing has no location cap',async()=>{
  const content=wrap('<rdf:Description rdf:about="urn:s"><ex:p>v</ex:p></rdf:Description>');const [expired,full]=await inspect({content,expired:true},{content,precharged:true});assert.equal(expired.locatedStatus,'TIMEOUT');assert.equal(full.locatedStatus,'LIMIT');for(const r of [expired,full]){assert.equal(r.returned,false);assert.equal(r.ordinaryStatus,'PARSED');}
  const many=wrap('<rdf:Description rdf:about="urn:s">'+'<ex:p>v</ex:p>'.repeat(200001)+'</rdf:Description>');const [ordinary]=await inspect({content:many,countOnly:true});assert.equal(ordinary.count,200001);
  const limit=wrap('<rdf:Description rdf:about="urn:s"><ex:p>'+'&e;'.repeat(1000)+'</ex:p></rdf:Description>','',`<!DOCTYPE rdf:RDF [<!ENTITY e "v">]>`);const [accepted]=await inspect({content:limit});indexed(accepted,limit);assert.equal(accepted.occurrences[0].triple.literal,'v'.repeat(1000));
});
