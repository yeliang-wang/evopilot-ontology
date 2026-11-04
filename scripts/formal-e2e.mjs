import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {evidenceReader,checkStandardsGate} from './standards-gate.mjs';

// A read-only admission check, never an arbitrary command launcher or approval writer.
export async function preflightProductE2E(evidenceRoot,requestPath,repositoryRoot){
  const reader=evidenceReader(evidenceRoot,repositoryRoot),request=reader.json(requestPath);
  const keys=['schema','candidate','corpus','toolchain','report'];
  if(!request||request.schema!=='ontology-product-e2e-request/v1'||Object.keys(request).sort().join()!==keys.sort().join())throw Error('INVALID_REQUEST: exact formal product E2E request required');
  const bindings={};for(const k of ['candidate','corpus','toolchain','report']){reader.ref(request[k]);bindings[k+'Digest']=request[k].digest;}
  const admission=await checkStandardsGate(evidenceRoot,bindings,repositoryRoot);reader.recheck();return admission;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const args=process.argv.slice(2);
    if(args.length!==4||args[0]!=='--evidence'||args[2]!=='--request')throw Error('Usage: node scripts/formal-e2e.mjs --evidence ABS_PRIVATE_DIR --request RELATIVE_JSON');
    console.log(JSON.stringify(await preflightProductE2E(args[1],args[3])));
  }catch(error){console.error(JSON.stringify({status:'BLOCKED',reason:error.message,acceptance:'NOT_EVALUATED',releaseAuthorized:false}));process.exitCode=1;}
}
