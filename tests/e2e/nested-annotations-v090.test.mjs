import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {execFile} from 'node:child_process';
import {readDLToolchain,verifyDLToolchain,javaClasspath} from '../../dist/reasoning/toolchain.js';
import {hashBytes} from '../../dist/standalone/validation.js';

// Expected structures are independently constructed with the DataFactory.
// RDF fixtures expand W3C mapping Tables 2/17, retaining one complete parent
// Annotation per reification. Equal whole annotations alone are deduplicated.
const javaSource=String.raw`
package io.evopilot.ontology;
import java.nio.file.*;
import java.io.StringReader;
import java.util.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.semanticweb.owlapi.model.*;
import org.semanticweb.owlapi.formats.*;
import org.semanticweb.owlapi.io.*;
import org.semanticweb.owlapi.rdf.turtle.parser.*;
import org.semanticweb.owlapi.rdf.rdfxml.parser.*;
import org.xml.sax.InputSource;

public final class NestedAnnotationProbe {
  static final ObjectMapper J=new ObjectMapper();
  static IRI iri(String s){return IRI.create(s);}
  static OWLAnnotationValue value(OWLDataFactory d,JsonNode v){
    return v.path("kind").asText().equals("iri")?iri(v.path("value").asText()):d.getOWLLiteral(v.path("value").asText());
  }
  static Set<OWLAnnotation> annotations(OWLDataFactory d,JsonNode list){
    var result=new HashSet<OWLAnnotation>();for(var n:list)result.add(d.getOWLAnnotation(d.getOWLAnnotationProperty(iri(n.path("property").asText())),value(d,n.path("value")),annotations(d,n.path("children"))));return result;
  }
  static Set<OWLAxiom> expected(OWLDataFactory d,JsonNode input){
    var result=new HashSet<OWLAxiom>();
    for(var c:input.path("classes"))result.add(d.getOWLDeclarationAxiom(d.getOWLClass(iri(c.asText()))));
    for(var p:input.path("properties"))result.add(d.getOWLDeclarationAxiom(d.getOWLAnnotationProperty(iri(p.asText()))));
    for(var a:input.path("axioms")){
      var anns=annotations(d,a.path("annotations"));
      switch(a.path("kind").asText()){
        case "declaration" -> {
          var entity=d.getOWLClass(iri(a.path("entity").asText()));result.remove(d.getOWLDeclarationAxiom(entity));result.add(d.getOWLDeclarationAxiom(entity,anns));
        }
        case "annotationAssertion" -> result.add(d.getOWLAnnotationAssertionAxiom(d.getOWLAnnotationProperty(iri(a.path("property").asText())),iri(a.path("subject").asText()),value(d,a.path("value")),anns));
        default -> result.add(d.getOWLSubClassOfAxiom(d.getOWLClass(iri(a.path("sub").asText())),d.getOWLClass(iri(a.path("sup").asText())),anns));
      }
    }
    return result;
  }
  static ObjectNode parse(JsonNode input,boolean located){
    var out=J.createObjectNode();out.put("located",located);out.put("resultReturned",false);
    try{
      var doc=J.createObjectNode();doc.put("format",input.path("format").asText());doc.put("content",input.path("content").asText());doc.put("digest",Worker.sha(input.path("content").asText()));
      long end=input.path("expired").asBoolean()?System.nanoTime()-1:System.nanoTime()+20_000_000_000L;
      var parsed=Worker.parse(Worker.manager(),doc,"urn:nested:document",List.of(),located,new RDFProvenance.Budget(end));
      var ontology=parsed.ontology();var d=ontology.getOWLOntologyManager().getOWLDataFactory();
      out.put("resultReturned",true);out.put("status","PARSED");
      out.put("exactAxioms",ontology.getAxioms().equals(expected(d,input)));
      out.put("exactOntologyAnnotations",ontology.getAnnotations().equals(annotations(d,input.path("ontologyAnnotations"))));
      out.put("profileLegal",Worker.profileViolations(ontology).isEmpty());
      var metadata=ontology.getOWLOntologyManager().getOntologyFormat(ontology).getOntologyLoaderMetaData();
      out.put("emptyResidual",metadata.isEmpty()||!(metadata.get() instanceof RDFParserMetaData rdf)||rdf.getUnparsedTriples().findAny().isEmpty());
      out.set("axioms",J.valueToTree(ontology.axioms().map(Object::toString).sorted().toList()));
      out.set("expected",J.valueToTree(expected(d,input).stream().map(Object::toString).sorted().toList()));
      out.set("ontologyAnnotations",J.valueToTree(ontology.annotations().map(Object::toString).sorted().toList()));
      out.put("locationReturned",parsed.rdfLocations()!=null);
    }catch(Exception e){out.put("status","REFUSED");out.put("errorClass",e.getClass().getName());out.put("error",e.toString());}
    return out;
  }
  static ObjectNode original(JsonNode input){
    var out=J.createObjectNode();
    try{
      var manager=Worker.manager();var o=manager.createOntology();var f=new TurtleDocumentFormat();var c=new Worker.MappingConsumer(o,Worker.loader(List.of()));c.setOntologyFormat(f);c.startModel(iri("urn:nested:document"));
      new TurtleParser(new StringReader(input.path("content").asText()),c,iri("urn:nested:document")).parseDocument();
      out.put("status","PARSED_RAW");out.put("exactAxioms",o.getAxioms().equals(expected(manager.getOWLDataFactory(),input)));
      var metadata=f.getOntologyLoaderMetaData();out.put("remaining",metadata.isPresent()&&metadata.get() instanceof RDFParserMetaData rdf?rdf.getUnparsedTriples().count():0);
    }catch(Exception e){out.put("status","REFUSED");out.put("error",e.toString());}
    return out;
  }
  static ObjectNode budgets(){
    var out=J.createObjectNode();long end=System.nanoTime()+20_000_000_000L;var b=new RDFProvenance.Budget(end);out.put("sameDeadline",b.deadlineNanos()==end);
    b.sourceRecords(800000);b.sourceRecords(800000);b.sourceReferences(2000000);b.sourceReferences(2000000);
    int limits=0,invalid=0;
    try{b.sourceRecords(1);}catch(RDFProvenance.LimitException e){limits++;}
    try{b.sourceReferences(Integer.MAX_VALUE);}catch(RDFProvenance.LimitException e){limits++;}
    try{b.sourceRecords(-1);}catch(RDFProvenance.MappingException e){invalid++;}
    try{b.sourceReferences(-1);}catch(RDFProvenance.MappingException e){invalid++;}
    out.put("limits",limits);out.put("invalid",invalid);
    try{new RDFProvenance.Budget(System.nanoTime()-1).sourceRecords(0);out.put("expired",false);}catch(RDFProvenance.TimeoutException e){out.put("expired",true);}
    return out;
  }
  public static void main(String[] args)throws Exception{
    var input=J.readTree(Files.readAllBytes(Path.of(args[0])));var out=J.createObjectNode();out.set("budgets",budgets());
    out.put("workerOrigin",Path.of(Worker.class.getProtectionDomain().getCodeSource().getLocation().toURI()).toRealPath().toString());
    var cases=out.putArray("cases");for(var item:input){var c=cases.addObject();c.set("ordinary",parse(item,false));if(item.path("format").asText().equals("turtle"))c.set("located",parse(item,true));if(item.path("original").asBoolean())c.set("original",original(item));}
    System.out.println(J.writeValueAsString(out));
  }
}
`;

let root,classes,binding,classpath,sequence=0;
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:8*1024*1024,...options},(e,stdout,stderr)=>e?reject(Error(`${file}: ${e.message}\n${stdout}\n${stderr}`)):resolve(stdout)));
before(async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN,'Actual pinned toolchain required');
  binding=readDLToolchain(process.env.EVOPILOT_TEST_DL_TOOLCHAIN);verifyDLToolchain(binding);
  assert.equal(binding.workerSourceDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/Worker.java',import.meta.url))));
  assert.equal(binding.dependencyLockDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/dependencies.json',import.meta.url))));
  root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-nested-annotations-')));classes=join(root,'classes');mkdirSync(classes,{mode:0o700});
  const source=join(root,'NestedAnnotationProbe.java');writeFileSync(source,javaSource,{mode:0o600});classpath=javaClasspath(binding);
  await execute(join(binding.javaRoot,'bin/javac'),['-encoding','UTF-8','-cp',classpath,'-d',classes,source]);
});
after(()=>{if(root)rmSync(root,{recursive:true,force:true});});
async function inspect(inputs){
  const file=join(root,'input-'+(++sequence)+'.json');writeFileSync(file,JSON.stringify(inputs),{mode:0o600});
  const r=JSON.parse(await execute(join(binding.javaRoot,'bin/java'),['-Xmx512m','-cp',[classes,classpath].join(delimiter),'io.evopilot.ontology.NestedAnnotationProbe',file]));
  assert.equal(r.workerOrigin,realpathSync(join(binding.root,'worker.jar')));
  assert.deepEqual(r.budgets,{sameDeadline:true,limits:2,invalid:2,expired:true});return r.cases;
}
const N='urn:nested:',RDF='http://www.w3.org/1999/02/22-rdf-syntax-ns#',RDFS='http://www.w3.org/2000/01/rdf-schema#',OWL='http://www.w3.org/2002/07/owl#';
const iri=value=>({kind:'iri',value}),literal=value=>({kind:'literal',value}),bnode=value=>({kind:'bnode',value});
const ann=(property,value,children=[])=>({property:N+property,value,children});
const xmlEscape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function formats(triples,expected,extra={}){
  const turtleTerm=v=>v.kind==='literal'?JSON.stringify(v.value):v.kind==='bnode'?'_:'+v.value:'<'+v.value+'>';
  const content=triples.map(([s,p,o])=>`${turtleTerm(s)} <${p}> ${turtleTerm(o)} .`).join('\n')+'\n';
  const namespaces=[['rdf',RDF],['rdfs',RDFS],['owl',OWL],['n',N]];
  const xml=triples.map(([s,p,o])=>{
    const [prefix,ns]=namespaces.find(([,ns])=>p.startsWith(ns));const tag=prefix+':'+p.slice(ns.length);
    const subject=s.kind==='bnode'?`rdf:nodeID="${xmlEscape(s.value)}"`:`rdf:about="${xmlEscape(s.value)}"`;
    const object=o.kind==='literal'?`>${xmlEscape(o.value)}</${tag}>`:o.kind==='bnode'?` rdf:nodeID="${xmlEscape(o.value)}"/>`:` rdf:resource="${xmlEscape(o.value)}"/>`;
    return `<rdf:Description ${subject}><${tag}${object}</rdf:Description>`;
  }).join('');
  return [{format:'turtle',content,...expected,...extra},{format:'rdfxml',content:`<rdf:RDF ${namespaces.map(([p,n])=>`xmlns:${p}="${n}"`).join(' ')}>${xml}</rdf:RDF>`,...expected,...extra,original:false}];
}
function fixture({resource=false,variants=['left','right'],depth=1,kind='subclass',ontology=false}={}){
  const value=resource?iri(N+'chosen'):literal('chosen');const classes=['A','B'].map(x=>N+x),properties=['note','mark','detail'].map(x=>N+x);
  const rows=[[iri(N+'O'),RDF+'type',iri(OWL+'Ontology')],...classes.map(x=>[iri(x),RDF+'type',iri(OWL+'Class')]),...properties.map(x=>[iri(x),RDF+'type',iri(OWL+'AnnotationProperty')])];
  const subject=ontology?iri(N+'O'):bnode('ax');let base;
  if(!ontology){
    base=kind==='declaration'?[iri(N+'A'),RDF+'type',iri(OWL+'Class')]:kind==='annotationAssertion'?[iri(N+'A'),N+'detail',literal('base')]:[iri(N+'A'),RDFS+'subClassOf',iri(N+'B')];
    if(kind!=='declaration')rows.push(base);
    rows.push([subject,RDF+'type',iri(OWL+'Axiom')],[subject,OWL+'annotatedSource',base[0]],[subject,OWL+'annotatedProperty',iri(base[1])],[subject,OWL+'annotatedTarget',base[2]]);
  }
  rows.push([subject,N+'note',value]);
  const expectedAnnotations=[];
  for(const [i,label] of variants.entries()){
    let node=bnode('r'+i);rows.push([node,RDF+'type',iri(OWL+'Annotation')],[node,OWL+'annotatedSource',subject],[node,OWL+'annotatedProperty',iri(N+'note')],[node,OWL+'annotatedTarget',value],[node,N+'mark',literal(label)]);
    let child=ann('mark',literal(label));expectedAnnotations.push(ann('note',value,[child]));
    for(let j=1;j<depth;j++){
      const next=bnode(`d${i}_${j}`),parentProperty=j===1?'mark':'detail',parentValue=j===1?label:'level-'+(j-1);
      rows.push([next,RDF+'type',iri(OWL+'Annotation')],[next,OWL+'annotatedSource',node],[next,OWL+'annotatedProperty',iri(N+parentProperty)],[next,OWL+'annotatedTarget',literal(parentValue)],[next,N+'detail',literal('level-'+j)]);
      child.children=[ann('detail',literal('level-'+j))];child=child.children[0];node=next;
    }
  }
  const axiom=kind==='declaration'?{kind,entity:N+'A',annotations:expectedAnnotations}:kind==='annotationAssertion'?{kind,subject:N+'A',property:N+'detail',value:literal('base'),annotations:expectedAnnotations}:{kind,sub:N+'A',sup:N+'B',annotations:expectedAnnotations};
  return {rows,expected:{classes,properties,axioms:ontology?[]:[axiom],ontologyAnnotations:ontology?expectedAnnotations:[]}};
}
function passed(result){
  for(const mode of ['ordinary','located'])if(result[mode]){
    const r=result[mode];assert.equal(r.status,'PARSED',JSON.stringify(r));
    for(const key of ['resultReturned','exactAxioms','exactOntologyAnnotations','profileLegal','emptyResidual'])assert.equal(r[key],true,key+' '+JSON.stringify(r));
    assert.equal(r.locationReturned,mode==='located');
  }
}
function refused(result){
  for(const mode of ['ordinary','located'])if(result[mode]){assert.equal(result[mode].status,'REFUSED',JSON.stringify(result));assert.equal(result[mode].resultReturned,false);assert.equal(result[mode].axioms,undefined);}
}

test('distinct complete nested annotations sharing one base survive; original findAny loss is independently observed',async()=>{
  const inputs=[false,true].flatMap(resource=>{const f=fixture({resource});return formats(f.rows,f.expected,{original:true});});
  const results=await inspect(inputs);results.forEach(passed);
  for(const r of results)if(r.original){assert.equal(r.original.status,'PARSED_RAW');assert.equal(r.original.exactAxioms,false);assert.ok(r.original.remaining>0);}
});
test('equal complete annotations deduplicate, and nested depth preserves structure rather than flattening children',async()=>{
  const inputs=[fixture({variants:['same','same']}),fixture({depth:3})].flatMap(f=>formats(f.rows,f.expected));(await inspect(inputs)).forEach(passed);
});
test('nested annotation attachment handles annotated declarations, annotation assertions and named ontology annotations',async()=>{
  const inputs=[fixture({kind:'declaration'}),fixture({kind:'annotationAssertion'}),fixture({ontology:true})].flatMap(f=>formats(f.rows,f.expected));(await inspect(inputs)).forEach(passed);
});
test('triple-order permutations and exact duplicate statements retain full selected structures',async()=>{
  const f=fixture({depth:2});const reversed=[...f.rows].reverse(),duplicates=[...f.rows,...f.rows.slice(-5)];
  (await inspect([...formats(reversed,f.expected),...formats(duplicates,f.expected)])).forEach(passed);
});
test('missing typing, dangling groups, mismatched terms and conflicting reification fields are refused',async()=>{
  const f=fixture({variants:['only']});const node='r0';const belongs=t=>t[0].kind==='bnode'&&t[0].value===node;
  const variants=[
    f.rows.filter(t=>!(belongs(t)&&t[1]===RDF+'type')),
    f.rows.filter(t=>!(t[0].value==='ax'&&t[1]===N+'note')),
    f.rows.map(t=>belongs(t)&&t[1]===OWL+'annotatedSource'?[t[0],t[1],bnode('foreign')]:t),
    f.rows.map(t=>belongs(t)&&t[1]===OWL+'annotatedTarget'?[t[0],t[1],iri(N+'chosen')]:t),
    [...f.rows,[bnode(node),OWL+'annotatedSource',iri(N+'O')]],
    [...f.rows,[bnode(node),OWL+'annotatedTarget',literal('different')]],
  ];
  (await inspect(variants.flatMap(rows=>formats(rows,f.expected)))).forEach(refused);
});
test('foreign incoming/outgoing uses and same-valued unrelated ontology annotations cannot authorize consumption',async()=>{
  const f=fixture({variants:['only']});
  const variants=[
    [...f.rows,[bnode('r0'),RDFS+'subClassOf',iri(N+'B')]],
    [...f.rows,[iri(N+'A'),N+'detail',bnode('r0')]],
    [...f.rows,[iri(N+'O'),N+'note',literal('chosen')],[bnode('orphan'),RDF+'type',iri(OWL+'Annotation')],[bnode('orphan'),OWL+'annotatedSource',bnode('unused')],[bnode('orphan'),OWL+'annotatedProperty',iri(N+'note')],[bnode('orphan'),OWL+'annotatedTarget',literal('chosen')],[bnode('orphan'),N+'mark',literal('only')]],
  ];
  (await inspect(variants.flatMap(rows=>formats(rows,f.expected)))).forEach(refused);
});
test('pending annotation flush on unsupported reserved axioms cannot reuse a previous actual axiom',async()=>{
  const f=fixture({variants:['only']});const prior=fixture({variants:['prior']});
  const renamed=prior.rows.map(t=>t.map((v,i)=>i===1?v:v.kind==='bnode'?bnode('prior-'+v.value):v));
  const malformed=f.rows.map(t=>t[0].value==='ax'&&t[1]===OWL+'annotatedProperty'?[t[0],t[1],iri(OWL+'unsupportedPredicate')]:t);
  malformed.push([iri(N+'A'),OWL+'unsupportedPredicate',iri(N+'B')]);
  (await inspect(formats([...renamed,...malformed],f.expected))).forEach(refused);
});
test('cyclic/deep annotation structures and the original expired deadline fail without results',async()=>{
  const f=fixture({variants:['only']});
  const cycle=f.rows.map(t=>t[0].value==='r0'&&t[1]===OWL+'annotatedSource'?[t[0],t[1],bnode('r0')]:t);
  cycle.push([bnode('r0'),N+'note',literal('chosen')]);
  const deep=fixture({variants:['only'],depth:130});
  (await inspect([...formats(cycle,f.expected),...formats(deep.rows,deep.expected),...formats(f.rows,f.expected,{expired:true})])).forEach(refused);
});
