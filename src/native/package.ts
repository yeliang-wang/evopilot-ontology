import { nativeExact, nativeText, nativeDigest, nativeAssertJSON, nativeBytesDigest, nativeSha256, validateNativePackage, nativeFrozenClone } from '../../vendor/compatibility/v1/native.mjs';
import type { NativePackage, NativeScope } from '../../vendor/compatibility/v1/native.mjs';
import { inspectOntologyStandard } from './standard.js';
import { fail } from '../state.js';
export interface OntologyCoverage { schema: 'evopilot-ontology-coverage/v1'; projectRoot: string; namespace: string; expectedEntities: { id: string; type: string }[]; requiredShapeIds: string[]; requiredCaseIds: string[] }
export interface SourceBindings { schema: 'evopilot-source-bindings/v1'; direction: 'forward' | 'reverse'; sources: { id: string; locator: string; revision: string; digest: string; status: string; visibility: string; contentPath:string }[]; requirements: { id: string; required: boolean; disposition: 'covered' | 'unresolved' | 'not-applicable'; reason?: string }[]; mappings: { requirementId: string; targetId: string; sourceId: string; status: string; revision:string; fileDigest:string; selector:{kind:'json-pointer';pointer:string}|{kind:'lines';start:number;end:number};fragmentDigest:string;rationale?:string }[] }
export interface OntologyCases { schema: 'evopilot-ontology-cases/v1'; cases: { id: string; data: string; expectedConforms: boolean; requirementIds: string[]; shapeIds: string[] }[] }
const statuses = ['observed','inferred'];
function iri(value: unknown): asserts value is string { nativeText(value); if (!/^https?:\/\/[^\s<>"{}|\\^`]+$|^urn:[^\s<>"{}|\\^`]+$/.test(value)) fail('INVALID_PACKAGE','Absolute stable IRI required'); }
function unique(values: string[], message: string): void { if (!values.length || new Set(values).size !== values.length) fail('INVALID_PACKAGE', message); }
export function packageParts(pkg: NativePackage): { coverage: OntologyCoverage; bindings: SourceBindings; cases: OntologyCases } {
  return { coverage: JSON.parse(pkg.files[pkg.manifest.entrypoints.coverage as string]) as OntologyCoverage, bindings: JSON.parse(pkg.files[pkg.manifest.sourceBindingRef]) as SourceBindings, cases: JSON.parse(pkg.files[pkg.manifest.entrypoints.cases as string]) as OntologyCases };
}
export function validateOntologyPackage(value: unknown, scope?: NativeScope): Readonly<NativePackage> {
  const standard = inspectOntologyStandard();
  const pkg = validateNativePackage(value, { owner: 'ontology', standardPins: standard, contractDigest: standard.contractDigest });
  if (scope && pkg.manifest.visibility !== scope.visibility) fail('SCOPE_MISMATCH','Package visibility differs from request');
  const ep = pkg.manifest.entrypoints;
  nativeExact(ep,['model','shapes','instances','coverage','cases']);
  if (ep.model !== 'model.ttl' || ep.coverage !== 'scope/coverage.json' || ep.cases !== 'tests/cases.json' || pkg.manifest.sourceBindingRef !== 'sources/bindings.json') fail('INVALID_LAYOUT','Required native entrypoint directory differs');
  for (const key of ['shapes','instances'] as const) {
    if (!Array.isArray(ep[key]) || !ep[key].length || ep[key].some(path => !path.startsWith(key + '/') || !path.endsWith('.ttl'))) fail('INVALID_LAYOUT','Nonempty native Turtle entrypoints required');
  }
  const turtle = new Set([ep.model, ...ep.shapes as string[], ...ep.instances as string[]]);
  for (const f of pkg.manifest.files) {
    const sourceData=f.path.startsWith('sources/')&&f.path!=='sources/bindings.json';
    if(sourceData){if(!['text/plain','text/markdown','application/json','text/turtle'].includes(f.mediaType))fail('UNSUPPORTED_MEDIA','Source bytes must have explicit text media');continue;}
    if (f.path.endsWith('.ttl') ? f.mediaType !== 'text/turtle' : f.path.endsWith('.json') ? f.mediaType !== 'application/json' : f.mediaType !== 'text/markdown') fail('UNSUPPORTED_MEDIA','Only explicit Turtle, JSON and Markdown files supported');
    if (/\.(jsonld|trig|nq|rdf|xml|js|py|wasm)$/i.test(f.path)) fail('UNSUPPORTED_MEDIA','Executable or alternate graph format unsupported');
    if (f.path.endsWith('.ttl') && !turtle.has(f.path) && !f.path.startsWith('tests/')) fail('UNMANIFESTED_GRAPH','Every graph must have an explicit role');
    if (/model\.json$/i.test(f.path)) fail('AMBIGUOUS_SOURCE','Turtle is the unique authoritative model');
  }
  const {coverage:c,bindings:b,cases:t}=packageParts(pkg);
  nativeExact(c,['schema','projectRoot','namespace','expectedEntities','requiredShapeIds','requiredCaseIds']);
  if (c.schema !== 'evopilot-ontology-coverage/v1') fail('INVALID_COVERAGE','Unknown coverage schema');
  iri(c.projectRoot); iri(c.namespace);
  if (!Array.isArray(c.expectedEntities)||!Array.isArray(c.requiredShapeIds)||!Array.isArray(c.requiredCaseIds)) fail('INVALID_COVERAGE','Fixed nonempty coverage lists required');
  for (const e of c.expectedEntities) { nativeExact(e,['id','type']); iri(e.id); iri(e.type); }
  unique(c.expectedEntities.map(e=>e.id),'Duplicate or empty expected identities');
  if (!c.expectedEntities.some(e=>e.id===c.projectRoot)) fail('INVALID_COVERAGE','Fixed root must be an expected identity');
  c.requiredShapeIds.forEach(iri); c.requiredCaseIds.forEach(nativeText);
  unique(c.requiredShapeIds,'Duplicate or empty required shapes'); unique(c.requiredCaseIds,'Duplicate or empty required tests');
  nativeExact(b,['schema','direction','sources','requirements','mappings']);
  if (b.schema!=='evopilot-source-bindings/v1'||!['forward','reverse'].includes(b.direction)||!Array.isArray(b.sources)||!Array.isArray(b.requirements)||!Array.isArray(b.mappings)) fail('INVALID_BINDINGS','Explicit provenance collections required');
  for (const s of b.sources) {
    nativeExact(s,['id','locator','revision','digest','status','visibility','contentPath']); [s.id,s.locator,s.revision].forEach(nativeText); nativeDigest(s.digest);
    if(typeof s.contentPath!=='string'||!s.contentPath.startsWith('sources/')||s.contentPath==='sources/bindings.json'||!Object.hasOwn(pkg.files,s.contentPath)||nativeBytesDigest(pkg.files[s.contentPath])!==s.digest)fail('SOURCE_DIGEST_MISMATCH','Manifested source bytes must equal file digest');
    if (!statuses.includes(s.status)||!['private','public'].includes(s.visibility)||pkg.manifest.visibility==='public'&&s.visibility==='private') fail('SOURCE_SCOPE_MISMATCH','Source classification/visibility invalid');
  }
  unique(b.sources.map(s=>s.id),'Duplicate or empty sources');
  for (const r of b.requirements) {
    nativeExact(r,['id','required','disposition'],['reason']); nativeText(r.id);
    if (typeof r.required!=='boolean'||!['covered','unresolved','not-applicable'].includes(r.disposition)) fail('INVALID_REQUIREMENTS','Explicit requirement disposition required');
    if (r.disposition!=='covered') nativeText(r.reason);
    if (r.required&&r.disposition==='unresolved') fail('UNRESOLVED_REQUIREMENT','Required interpretation remains unresolved');
  }
  unique(b.requirements.map(r=>r.id),'Duplicate or empty requirements');
  const pairs=new Set<string>();
  for (const m of b.mappings) {
    nativeExact(m,['requirementId','targetId','sourceId','status','revision','fileDigest','selector','fragmentDigest'],['rationale']); iri(m.targetId);nativeDigest(m.fileDigest);nativeDigest(m.fragmentDigest);if(m.rationale!==undefined)nativeText(m.rationale);if(m.status==='inferred')nativeText(m.rationale);
    const source=b.sources.find(s=>s.id===m.sourceId), requirement=b.requirements.find(r=>r.id===m.requirementId);
    if (!source||!requirement||requirement.disposition!=='covered'||!statuses.includes(m.status)||source.status==='inferred'&&m.status==='observed') fail('INVALID_BINDINGS','Dangling or misclassified source mapping');
    if(m.revision!==source.revision||m.fileDigest!==source.digest)fail('SOURCE_BINDING_MISMATCH','Mapping must bind exact source revision/file digest');
    const content=pkg.files[source.contentPath];let actual:string;
    if(m.selector.kind==='lines'){nativeExact(m.selector,['kind','start','end']);const lines=content.split('\n'),{start,end}=m.selector;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end>lines.length)fail('INVALID_SELECTOR','Inclusive source line range required');actual=nativeBytesDigest(lines.slice(start-1,end).join('\n'));}
    else if(m.selector.kind==='json-pointer'){nativeExact(m.selector,['kind','pointer']);const pointer=m.selector.pointer;if(typeof pointer!=='string'||pointer!==''&&!pointer.startsWith('/')||/~(?:[^01]|$)/.test(pointer))fail('INVALID_SELECTOR','RFC6901 JSON Pointer required');let selected:unknown;try{selected=JSON.parse(content);}catch{fail('INVALID_SELECTOR','JSON selector source must parse');}if(pointer!=='')for(const raw of pointer.slice(1).split('/')){const key=raw.replaceAll('~1','/').replaceAll('~0','~');if(!selected||typeof selected!=='object'||!Object.hasOwn(selected,key)||Array.isArray(selected)&&!/^(0|[1-9][0-9]*)$/.test(key))fail('INVALID_SELECTOR','JSON Pointer target absent');selected=(selected as Record<string,unknown>)[key];}actual=nativeSha256(selected);}
    else fail('INVALID_SELECTOR','Only explicit JSON Pointer or line segment supported');
    if(actual!==m.fragmentDigest)fail('SOURCE_FRAGMENT_MISMATCH','Selected original source fragment differs');
    const key=JSON.stringify(m); if (pairs.has(key)) fail('INVALID_BINDINGS','Duplicate mapping'); pairs.add(key);
  }
  for (const r of b.requirements) if(r.disposition==='covered'&&!b.mappings.some(m=>m.requirementId===r.id)) fail('MISSING_COVERAGE','Requirement lacks source-to-asset mapping');
  nativeExact(t,['schema','cases']);
  if(t.schema!=='evopilot-ontology-cases/v1'||!Array.isArray(t.cases))fail('INVALID_CASES','Fixed native case catalog required');
  unique(t.cases.map(x=>x.id),'Duplicate or empty case IDs');
  if(JSON.stringify([...c.requiredCaseIds].sort())!==JSON.stringify(t.cases.map(x=>x.id).sort()))fail('MISSING_CASE','Case set must equal fixed required set');
  for(const x of t.cases){
    nativeExact(x,['id','data','expectedConforms','requirementIds','shapeIds']); nativeText(x.id);
    if(typeof x.expectedConforms!=='boolean'||typeof x.data!=='string'||!x.data.startsWith('tests/')||!x.data.endsWith('.ttl')||!Object.hasOwn(pkg.files,x.data))fail('INVALID_CASES','Manifested native expected case required');
    if(!Array.isArray(x.requirementIds)||!Array.isArray(x.shapeIds))fail('INVALID_CASES','Case coverage required');
    unique(x.requirementIds,'Empty case requirements'); unique(x.shapeIds,'Empty case shapes');
    if(x.requirementIds.some(id=>!b.requirements.some(r=>r.id===id&&r.disposition==='covered'))||x.shapeIds.some(id=>!c.requiredShapeIds.includes(id)))fail('INVALID_CASES','Dangling case coverage');
  }
  for(const id of c.requiredShapeIds) for(const expected of [true,false]) if(!t.cases.some(x=>x.shapeIds.includes(id)&&x.expectedConforms===expected))fail('MISSING_CASE','Every required shape needs independent positive and negative cases');
  for(const r of b.requirements.filter(r=>r.required&&r.disposition==='covered')) for(const expected of [true,false]) if(!t.cases.some(x=>x.requirementIds.includes(r.id)&&x.expectedConforms===expected))fail('MISSING_CASE','Every required covered requirement needs independent positive and negative cases');
  nativeAssertJSON(pkg);
  return nativeFrozenClone(pkg);
}
