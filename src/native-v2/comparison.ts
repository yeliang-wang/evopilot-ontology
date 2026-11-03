import type {Json,ModelingIntent,WorkspaceIdentity} from '../standalone/types.js';
import {fail} from '../standalone/types.js';
import {canonical,hash} from '../standalone/validation.js';
import type {ModelAdmission} from './models.js';
import type {SourceAdmission} from './sources.js';
import type {ExpectationAdmission} from './expectations.js';
import type {ExpectationSet} from './expectations-contracts.js';
import type {DerivedView} from './projection-contracts.js';
import type {VerifiedValidation,VerifiedCheck} from './task-evidence.js';

export const COMPARISON_LIMITS=Object.freeze({reportBytes:32*1024*1024,pageBytes:65536});
export interface ComparisonSide {
  model:ModelAdmission;intent:ModelingIntent;sources:SourceAdmission;
  expectations:ExpectationAdmission|null;validation:VerifiedValidation|null;view:DerivedView|null;
}
type Case=ExpectationSet['cases'][number];
type Change<T>={id:string;change:'ADDED'|'REMOVED'|'CHANGED';before:T|null;after:T|null};
const json=(v:unknown)=>v as Json;
const same=(a:unknown,b:unknown)=>canonical(json(a))===canonical(json(b));
const ordered=(values:readonly string[])=>[...values].sort();
function differences<T>(a:readonly T[],b:readonly T[],key:(v:T)=>string):Change<T>[] {
  const before=new Map(a.map(v=>[key(v),v])),after=new Map(b.map(v=>[key(v),v]));
  return [...new Set([...before.keys(),...after.keys()])].sort().flatMap(id=>{
    const left=before.get(id)??null,right=after.get(id)??null;
    return same(left,right)?[]:[{id,change:left===null?'ADDED' as const:right===null?'REMOVED' as const:'CHANGED' as const,before:left,after:right}];
  });
}
const documentSummary=<T extends {content:string}>(d:T)=>{const {content,...metadata}=d;return {...metadata,bytes:Buffer.byteLength(content)};};
const caseSummary=(c:Case)=>c.kind==='owl-entailment'?c:{...c,closure:{...c.closure,documents:c.closure.documents.map(documentSummary)}};
const checkSummary=(c:VerifiedCheck|undefined)=>c?{id:c.id,kind:c.kind,expected:c.expected,actual:c.actual,matched:c.matched,resultDigest:c.resultDigest}:null;
const consistent=(s:ComparisonSide)=>s.validation?.checks.find(c=>c.id==='model-consistency')?.matched===true;
function sameProbe(a:Case,b:Case):boolean {
  if(a.kind!==b.kind)return false;
  return a.kind==='owl-entailment'&&b.kind==='owl-entailment'?same(a.query,b.query):a.kind==='shacl'&&b.kind==='shacl'&&same(a.closure,b.closure);
}
function caseObservations(from:ComparisonSide,to:ComparisonSide){
  const a=from.expectations?.definition.cases??[],b=to.expectations?.definition.cases??[];
  const toolsMatch=!!from.validation&&!!to.validation&&from.validation.binding.toolchainDigest===to.validation.binding.toolchainDigest;
  return [...new Set([...a.map(c=>c.id),...b.map(c=>c.id)])].sort().map(id=>{
    const left=a.find(c=>c.id===id),right=b.find(c=>c.id===id);
    const old=from.validation?.checks.find(c=>c.id===id),next=to.validation?.checks.find(c=>c.id===id);
    const sameTest=!!left&&!!right&&sameProbe(left,right),both=!!old&&!!next;
    const expectationChanged=!!left&&!!right&&(left.kind!==right.kind||(left.kind==='owl-entailment'&&right.kind==='owl-entailment'?left.expectedStatus!==right.expectedStatus:left.kind==='shacl'&&right.kind==='shacl'&&(!same(left.expectedViolationShapeIris,right.expectedViolationShapeIris)||left.expectedConforms!==right.expectedConforms)));
    const flags:string[]=[];
    if(!left)flags.push('CASE_ADDED');if(!right)flags.push('CASE_REMOVED');
    if(left&&right&&!sameTest)flags.push('PROBE_CHANGED');
    if(expectationChanged)flags.push('EXPECTED_OUTCOME_CHANGED');
    if(left&&right&&!same(ordered(left.requirementIds),ordered(right.requirementIds)))flags.push('REQUIREMENT_BINDING_CHANGED');
    if(!same(from.expectations?.definition.requiredShapes??null,to.expectations?.definition.requiredShapes??null))flags.push('REQUIRED_SHAPES_CHANGED');
    if(!same(from.model.draft.shapes,to.model.draft.shapes)&&(left?.kind==='shacl'||right?.kind==='shacl'))flags.push('CANDIDATE_SHAPES_CHANGED');
    if(!both)flags.push('FORMAL_EVIDENCE_MISSING');else if(!toolsMatch)flags.push('TOOLCHAIN_CHANGED');
    const comparable=both&&sameTest&&toolsMatch;
    let conclusionTransition='NOT_EVALUATED';
    if(both){
      conclusionTransition='NOT_COMPARABLE';
      if(comparable&&left?.kind==='owl-entailment'&&right?.kind==='owl-entailment'&&consistent(from)&&consistent(to)&&['ENTAILED','NOT_ENTAILED'].includes(old.actual)&&['ENTAILED','NOT_ENTAILED'].includes(next.actual))
        conclusionTransition=old.actual===next.actual?'UNCHANGED_FOR_THIS_QUERY':next.actual==='ENTAILED'?'GAINED_ENTAILMENT':'LOST_ENTAILMENT';
      else if(comparable&&left?.kind==='shacl'&&right?.kind==='shacl')conclusionTransition=old.actual===next.actual?'UNCHANGED_FOR_THIS_FIXTURE':'SHACL_FIXTURE_OUTCOME_CHANGED';
    }
    const oracleStable=comparable&&!expectationChanged&&same(from.expectations?.definition.requiredShapes??null,to.expectations?.definition.requiredShapes??null);
    const matchTransition=!both?'NOT_EVALUATED':!oracleStable?'NOT_COMPARABLE':old.matched===next.matched?'UNCHANGED':next.matched?'RECOVERED_FIXED_CASE':'REGRESSED_FIXED_CASE';
    return {id,requirementIds:ordered([...new Set([...(left?.requirementIds??[]),...(right?.requirementIds??[])])]),before:checkSummary(old),after:checkSummary(next),sameProbe:sameTest,expectationChanged,flags,conclusionTransition,matchTransition};
  });
}
function projectionComparison(from:ComparisonSide,to:ComparisonSide):Json {
  const a=from.view,b=to.view;
  if(!a||!b)return {status:'NOT_EVALUATED',reason:'Select retained views on both sides to compare named observations',allLogicalConsequences:false};
  const selection=(v:DerivedView)=>v.tasks.map(t=>({kind:t.kind,direct:t.direct,entities:ordered(t.entities)})).map(v=>canonical(json(v))).sort();
  const tools=(v:DerivedView)=>ordered([...new Set(v.tasks.map(t=>t.toolchainDigest))]);
  const scopeMatches=same(selection(a),selection(b)),toolsMatch=same(tools(a),tools(b));
  const key=(t:DerivedView['triples'][number])=>canonical([t.subject,t.predicate,t.object]);
  const old=new Map(a.triples.map(t=>[key(t),t])),next=new Map(b.triples.map(t=>[key(t),t]));
  return json({status:'COMPARED',selectionMatches:scopeMatches,toolchainMatches:toolsMatch,
    comparable:scopeMatches&&toolsMatch,beforeSelection:selection(a).map(v=>JSON.parse(v)),afterSelection:selection(b).map(v=>JSON.parse(v)),
    beforeOmittedInverseExpressions:a.tasks.reduce((n,t)=>n+t.omittedInverseExpressions,0),afterOmittedInverseExpressions:b.tasks.reduce((n,t)=>n+t.omittedInverseExpressions,0),
    observedOnlyBefore:[...old].filter(([k])=>!next.has(k)).sort(([a],[b])=>a<b?-1:1).map(([,v])=>v),
    observedOnlyAfter:[...next].filter(([k])=>!old.has(k)).sort(([a],[b])=>a<b?-1:1).map(([,v])=>v),
    absenceMeans:'NOT_IN_SELECTED_PROJECTION',allLogicalConsequences:false});
}

/** Inputs have been re-admitted by their scoped owner stores. This compares
 * immutable observations; it does not execute a reasoner or infer equivalence. */
export function compareModels(identity:Pick<WorkspaceIdentity,'workspaceId'|'serviceId'>,projectId:string,from:ComparisonSide,to:ComparisonSide):Json {
  if(from.model.draft.assetId!==to.model.draft.assetId)fail('COMPARISON_SCOPE','Both versions must belong to the selected asset',409);
  const a=from.model.draft,b=to.model.draft,ea=from.expectations?.definition,eb=to.expectations?.definition;
  const requirements=differences(from.intent.requirements,to.intent.requirements,r=>r.id);
  const sourceDocuments=differences(from.sources.sourceSet.sources.map(({content:_,...d})=>d),to.sources.sourceSet.sources.map(({content:_,...d})=>d),d=>d.id);
  const fragments=differences(from.sources.fragments,to.sources.fragments,f=>f.id);
  const ontologyDocuments=differences(a.closure.documents.map(d=>({...documentSummary(d),id:d.id})),b.closure.documents.map(d=>({...documentSummary(d),id:d.id})),d=>d.id);
  const shapeDocuments=differences(a.shapes.map(d=>({...documentSummary(d),id:d.id})),b.shapes.map(d=>({...documentSummary(d),id:d.id})),d=>d.id);
  const mappings=differences(a.mappings,b.mappings,m=>m.requirementId),expectedRequirements=differences(ea?.requirements??[],eb?.requirements??[],r=>r.requirementId);
  const expectedCases=differences((ea?.cases??[]).map(caseSummary),(eb?.cases??[]).map(caseSummary),c=>c.id),observations=caseObservations(from,to);
  const changedDocs=new Set([...ontologyDocuments,...shapeDocuments].map(d=>d.id)),changedFragments=new Set(fragments.map(f=>f.id));
  const impact=[...new Set([...from.intent.requirements,...to.intent.requirements].map(r=>r.id))].sort().map(requirementId=>{
    const reasons:string[]=[],selectedCases=observations.filter(c=>c.requirementIds.includes(requirementId));
    if(requirements.some(r=>r.id===requirementId))reasons.push('REQUIREMENT_CHANGED');
    if(mappings.some(m=>m.id===requirementId))reasons.push('DECLARED_MAPPING_CHANGED');
    if(from.model.closureDigest!==to.model.closureDigest)reasons.push('INPUT_CLOSURE_CHANGED_RECHECK_REQUIRED');
    const mapped=[...a.mappings,...b.mappings].filter(m=>m.requirementId===requirementId);
    if(mapped.some(m=>m.anchors.some(anchor=>changedDocs.has(anchor.documentId))))reasons.push('MAPPED_DOCUMENT_CHANGED');
    if(mapped.some(m=>m.sourceFragmentIds.some(id=>changedFragments.has(id))))reasons.push('MAPPED_SOURCE_FRAGMENT_CHANGED');
    if(expectedRequirements.some(r=>r.id===requirementId)||expectedCases.some(c=>[...(c.before?.requirementIds??[]),...(c.after?.requirementIds??[])].includes(requirementId)))reasons.push('INDEPENDENT_EXPECTATION_CHANGED');
    if(selectedCases.some(c=>c.before&&c.after&&(c.before.actual!==c.after.actual||c.before.matched!==c.after.matched)))reasons.push('FIXED_CASE_OBSERVATION_CHANGED');
    return {requirementId,before:from.intent.requirements.find(r=>r.id===requirementId)?.statement??null,after:to.intent.requirements.find(r=>r.id===requirementId)?.statement??null,reasons,caseIds:selectedCases.map(c=>c.id),affectedByRecordedEvidence:reasons.length>0,unobservedImpactExcluded:false};
  });
  const binding=(s:ComparisonSide)=>({modelDigest:s.model.digest,intentDigest:s.model.draft.intentDigest,sourceSetDigest:s.sources.sourceSetDigest,expectationsDigest:s.expectations?.digest??null,closureDigest:s.model.closureDigest,validation:s.validation?{...s.validation.binding,view:s.validation.view}:null,viewDigest:s.view?hash(json(s.view)):null});
  const intent=(s:ComparisonSide)=>({purpose:s.intent.purpose,mode:s.intent.mode,scope:s.intent.scope,exclusions:s.intent.exclusions});
  const report=json({schema:'ontology-model-comparison/v2',identity:{workspaceId:identity.workspaceId,serviceId:identity.serviceId,projectId,assetId:a.assetId},from:binding(from),to:binding(to),
    lineage:{sameModel:from.model.digest===to.model.digest,directSuccessor:b.previousDigest===from.model.digest,beforeParent:a.previousDigest,afterParent:b.previousDigest},
    declarations:{intent:{changed:!same(intent(from),intent(to)),before:intent(from),after:intent(to)},label:{before:a.label,after:b.label},requirements,sourceDocuments,fragments,ontologyDocuments,shapeDocuments,
      rootDocument:{before:a.closure.rootDocumentId,after:b.closure.rootDocumentId},imports:differences(a.closure.imports,b.closure.imports,i=>canonical([i.from,i.iri,i.to])),mappings,expectedRequirements,expectedCases,
      requiredShapes:differences(ea?.requiredShapes??[],eb?.requiredShapes??[],s=>s.shapeIri),openIssues:{before:a.openIssues,after:b.openIssues}},
    formal:{status:from.validation&&to.validation?'COMPARED':'NOT_EVALUATED',beforeStatus:from.validation?.status??null,afterStatus:to.validation?.status??null,
      toolchainMatches:from.validation&&to.validation?from.validation.binding.toolchainDigest===to.validation.binding.toolchainDigest:null,
      configurationMatches:from.validation&&to.validation?from.validation.binding.configurationDigest===to.validation.binding.configurationDigest:null,
      baseChecks:['model-consistency','model-shacl'].map(id=>({id,before:checkSummary(from.validation?.checks.find(c=>c.id===id)),after:checkSummary(to.validation?.checks.find(c=>c.id===id))})),cases:observations},
    projection:projectionComparison(from,to),requirementImpact:impact,
    claims:{scope:'DECLARATIONS_FIXED_CASES_AND_SELECTED_NAMED_PROJECTIONS',semanticEquivalence:'NOT_PROVEN',completeImpactAnalysis:false,byteChangesProveSemanticChanges:false,
      notEntailedMeansNegation:false,sourceMappings:'AUTHOR_DECLARED_DOCUMENT_BINDINGS',businessConfirmed:false,softwareReleaseAuthority:false}});
  if(Buffer.byteLength(canonical(report))>COMPARISON_LIMITS.reportBytes)fail('COMPARISON_LIMIT','Comparison exceeds its fixed byte budget',413);
  return report;
}
