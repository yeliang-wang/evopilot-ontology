import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inspectOntologyStandard } from '../../../dist/index.js';
const ex='https://example.invalid/r1/';
const source = path => readFileSync(new URL('../../../specifications/v1/examples/'+path,import.meta.url),'utf8');
const digest=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
export function nativePackage({visibility='private',id='synthetic-model',version='1.0.0'}={}){
  const standard=inspectOntologyStandard(),shapeIds=['ProjectShape','CapabilitiesShape','CapabilityShape','KindShape','OperationShape','LimitShape'];
  const model=source('positive/model.ttl'),data=source('positive/data.ttl');
  const shapes=source('positive/shapes.ttl');
  const negatives=[
    ['root-type','ProjectShape',data.replace('ex:project a ex:Project','ex:project a ex:Other')],
    ['relation','CapabilitiesShape',data.replace('ex:hasCapability ex:engine, ex:query','ex:hasCapability ex:engine')],
    ['combination','CapabilityShape',data.replace('ex:operation "execute"','ex:operation "search"')],
    ['kind','KindShape',data.replace('; ex:kind "ENGINE"','')],
    ['operation','OperationShape',data.replace('; ex:operation "execute"','')],
    ['limit','LimitShape',data.replace('; ex:limit 3','')]
  ];
  const cases=[{id:'positive',data:'tests/positive.ttl',expectedConforms:true,requirementIds:['scope'],shapeIds:shapeIds.map(s=>ex+s)},...negatives.map(([id,shape])=>({id,data:`tests/${id}.ttl`,expectedConforms:false,requirementIds:['scope'],shapeIds:[ex+shape]}))];
  const files={
    'model.ttl':model,'shapes/domain.ttl':shapes,'instances/current.ttl':data,'sources/source.txt':model+data,
    'scope/coverage.json':JSON.stringify({schema:'evopilot-ontology-coverage/v1',namespace:ex,projectRoot:ex+'project',expectedEntities:[{id:ex+'project',type:ex+'Project'},{id:ex+'engine',type:ex+'Capability'},{id:ex+'query',type:ex+'Capability'}],requiredShapeIds:shapeIds.map(s=>ex+s),requiredCaseIds:cases.map(x=>x.id)}),
    'sources/bindings.json':JSON.stringify({schema:'evopilot-source-bindings/v1',direction:'reverse',sources:[{id:'source',locator:'synthetic://example',revision:'fixture-1',digest:digest(model+data),status:'observed',visibility,contentPath:'sources/source.txt'}],requirements:[{id:'scope',required:true,disposition:'covered'}],mappings:['Project','Capability','hasCapability',...shapeIds].map(s=>({requirementId:'scope',targetId:ex+s,sourceId:'source',status:'observed',revision:'fixture-1',fileDigest:digest(model+data),selector:{kind:'lines',start:1,end:(model+data).split('\n').length},fragmentDigest:digest(model+data)}))}),
    'tests/cases.json':JSON.stringify({schema:'evopilot-ontology-cases/v1',cases}),'tests/positive.ttl':data,
    ...Object.fromEntries(negatives.map(([id,,content])=>[`tests/${id}.ttl`,content]))
  };
  return {manifest:{schema:'evopilot-native-package/v1',specVersion:'v1',owner:'ontology',id,version,visibility,standardPins:{standardDigest:standard.standardDigest,standardLockDigest:standard.standardLockDigest},contractDigest:standard.contractDigest,producer:{product:'ontology',version:'0.3.0'},entrypoints:{model:'model.ttl',shapes:['shapes/domain.ttl'],instances:['instances/current.ttl'],coverage:'scope/coverage.json',cases:'tests/cases.json'},files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en')).map(([path,content])=>({path,mediaType:path.endsWith('.ttl')?'text/turtle':path.endsWith('.txt')?'text/plain':'application/json',sha256:digest(content).slice(7)})),dependencies:[],sourceBindingRef:'sources/bindings.json'},files};
}
export function rehash(pkg){pkg.manifest.files=Object.entries(pkg.files).sort(([a],[b])=>a.localeCompare(b,'en')).map(([path,content])=>({path,mediaType:path.endsWith('.ttl')?'text/turtle':path.endsWith('.txt')?'text/plain':'application/json',sha256:digest(content).slice(7)}));return pkg;}
