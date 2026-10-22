import type {RowPresentation} from '../vendor/readability/v1/presentation.mjs';
export interface Term {kind:'iri'|'blank'|'literal';value:string;datatype?:string|null;language?:string|null}
export type Triple=[Term,Term,Term];
const RDFS='http://www.w3.org/2000/01/rdf-schema#',SH='http://www.w3.org/ns/shacl#',RDF='http://www.w3.org/1999/02/22-rdf-syntax-ns#',OWL='http://www.w3.org/2002/07/owl#';
const pathOperators=new Set(['inversePath','alternativePath','zeroOrMorePath','oneOrMorePath','zeroOrOnePath'].map(p=>SH+p));
// Classify declared subjects only. RDF lists and path expressions are retained as
// structure, not presented as independent business constraints or inferred shapes.
export function shapeNodeKind(triples:Triple[]):'constraint'|'structure' {
 return triples.some(([,p,o])=>p.value===RDF+'type'&&[SH+'NodeShape',SH+'PropertyShape'].includes(o.value)
  ||p.value.startsWith(SH)&&!pathOperators.has(p.value))?'constraint':'structure';
}
export function shapeNodeRank(triples:Triple[]):number {
 if(shapeNodeKind(triples)==='structure')return 4;
 if(triples.some(([,p])=>[SH+'targetClass',SH+'targetNode',SH+'targetSubjectsOf',SH+'targetObjectsOf'].includes(p.value)))return 0;
 if(triples.some(([,p])=>p.value===SH+'path'))return 1;
 return triples[0][0].kind==='iri'?2:3;
}
const SKOS='http://www.w3.org/2004/02/skos/core#';
const constraintNames:Record<string,string>={minCount:'最少数量',maxCount:'最多数量',minExclusive:'必须大于（严格下界）',maxExclusive:'必须小于（严格上界）',minInclusive:'不得小于（含边界）',maxInclusive:'不得大于（含边界）',datatype:'数据类型',class:'必须属于类',hasValue:'必须包含指定值',nodeKind:'节点类型',pattern:'正则约束',in:'允许值列表',closed:'封闭形状',property:'属性形状',node:'节点形状',or:'至少符合其中一项',and:'符合全部条件',not:'不得符合该形状',xone:'仅符合其中一项'};
export function nativeTerm(t:Term):string {
 if(t.kind==='blank')return '_:'+t.value;
 if(t.kind==='iri')return t.value;
 return JSON.stringify(t.value)+(t.language?'@'+t.language:t.datatype?'^^'+t.datatype:'');
}
export function ontologyPresentation(graphs:{path:string;role:string;triples:Triple[]}[]) {
 const labels=new Map<string,string[]>();
 for(const g of graphs)for(const [s,p,o]of g.triples)if(p.value===RDFS+'label'&&o.kind==='literal'){
  const key=s.kind==='blank'?g.path+'#'+s.value:s.value,all=labels.get(key)??[];all.push(nativeTerm(o));labels.set(key,all);
 }
 const name=(t:Term,path:string)=>{const label=labels.get(t.kind==='blank'?path+'#'+t.value:t.value);return label?[...new Set(label)].join(' / '):nativeTerm(t);};
 return {name,present(role:string,path:string,triples:Triple[]):RowPresentation{
  const subject=triples[0][0];
  const objects=(predicate:string)=>triples.filter(t=>t[1].value===predicate).map(t=>nativeTerm(t[2])).join('；')||'未提供';
  const types=triples.filter(t=>t[1].value===RDF+'type').map(t=>t[2].value);
  const definition=[...triples.filter(t=>[RDFS+'comment',SKOS+'definition',SH+'description'].includes(t[1].value))].map(t=>nativeTerm(t[2])).join('；')||'未提供';
  if(role==='shape')return {section:'constraints',cells:{target:[SH+'targetClass',SH+'targetNode',SH+'targetSubjectsOf',SH+'targetObjectsOf'].flatMap(p=>triples.filter(t=>t[1].value===p).map(t=>p+' = '+nativeTerm(t[2]))).join('；')||'见所属形状（本节点未声明 target）',path:objects(SH+'path'),constraint:triples.filter(t=>t[1].value!==SH+'path'&&t[1].value!==SH+'severity'&&t[1].value.startsWith(SH)).map(t=>t[1].value.slice(SH.length)+' = '+nativeTerm(t[2])+(constraintNames[t[1].value.slice(SH.length)]?'（'+constraintNames[t[1].value.slice(SH.length)]+'）':'')).join('；')||'无直接 SHACL 参数；见原生声明',severity:objects(SH+'severity')}};
  if(role==='instance')return {section:'instances',cells:{name:name(subject,path),types:objects(RDF+'type'),values:triples.filter(t=>![RDF+'type',RDFS+'label'].includes(t[1].value)).map(t=>name(t[1],path)+' = '+nativeTerm(t[2])).join('；')||'未提供'}};
  if(types.some(t=>[OWL+'ObjectProperty',OWL+'DatatypeProperty',OWL+'AnnotationProperty',RDF+'Property'].includes(t)))return {section:'properties',cells:{name:name(subject,path),domain:objects(RDFS+'domain'),range:objects(RDFS+'range'),definition}};
  return {section:'concepts',cells:{name:name(subject,path),types:objects(RDF+'type'),definition}};
 }};
}
export function relationTriple(t:Triple,role:string):boolean {
 if(t[2].kind==='literal')return false;
 if([RDF+'type',RDFS+'label',RDFS+'comment'].includes(t[1].value))return false;
 // SHACL structure is fully available in constraint rows. Additional graph links retain direction.
 return role!=='shape'||[SH+'property',SH+'node',SH+'qualifiedValueShape'].includes(t[1].value);
}
