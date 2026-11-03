import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Deliberately bounded projection of this owned schema, not a general codegen
// platform. Unknown keywords/forms fail instead of silently weakening types.
for(const [file,title,prefix,constant] of [['sources','SourceSet','','SOURCE'],['model','ModelDraft','model-','MODEL'],['shacl','SHACLRequest','shacl-','SHACL']]){
const source=new URL('../schemas/v2/'+file+'.schema.json',import.meta.url);
const bytes=readFileSync(source),schema=JSON.parse(bytes);
const model=JSON.parse(readFileSync(new URL('../schemas/v2/model.schema.json',import.meta.url))),externalTypes=new Set();
const allowed=new Set(['$schema','$id','title','description','$defs','$ref','type','const','enum','oneOf','properties','required','additionalProperties','items','minItems','maxItems','minLength','maxLength','pattern','minimum','maximum']);
function type(node){
  for(const key of Object.keys(node))assert(allowed.has(key),'Unsupported schema projection keyword: '+key);
  if(node.$ref){
    assert.deepEqual(Object.keys(node),['$ref']);const name=node.$ref.split('/').at(-1);
    if(file==='shacl'&&node.$ref==='urn:evopilot:ontology:model-draft:v2#/$defs/'+name){assert(Object.hasOwn(model.$defs,name));externalTypes.add(name);return 'Model'+name;}
    assert(/^#\/\$defs\/[A-Za-z][A-Za-z0-9]*$/.test(node.$ref));assert(Object.hasOwn(schema.$defs,name));return name;
  }
  if(node.oneOf){assert.deepEqual(Object.keys(node),['oneOf']);assert(node.oneOf.length);return '('+node.oneOf.map(type).join(' | ')+')';}
  if(Object.hasOwn(node,'const')){assert.equal(typeof node.const,node.type);return JSON.stringify(node.const);}
  if(node.enum){assert(node.enum.length&&node.enum.every(v=>typeof v===node.type));return node.enum.map(v=>JSON.stringify(v)).join(' | ');}
  if(node.type==='string')return 'string';
  if(node.type==='integer'||node.type==='number')return 'number';
  if(node.type==='boolean')return 'boolean';
  if(node.type==='null')return 'null';
  if(node.type==='array')return 'readonly ('+type(node.items)+')[]';
  assert.equal(node.type,'object');assert.equal(node.additionalProperties,false);assert(node.properties&&Array.isArray(node.required));
  assert.equal(new Set(node.required).size,node.required.length);assert(node.required.every(k=>Object.hasOwn(node.properties,k)));
  return '{ '+Object.entries(node.properties).map(([key,value])=>'readonly '+JSON.stringify(key)+(node.required.includes(key)?'':'?')+': '+type(value)+';').join(' ')+' }';
}
assert.equal(schema.$schema,'https://json-schema.org/draft/2020-12/schema');assert.equal(schema.title,title);
const sha='sha256:'+createHash('sha256').update(bytes).digest('hex');
const header='// Generated from schemas/v2/'+file+'.schema.json; edit the schema, then regenerate.\n';
const declarations=Object.entries(schema.$defs).map(([name,value])=>'export type '+name+' = '+type(value)+';\n').join('')+'export type '+title+' = '+type(schema)+';\n';
const imports=externalTypes.size?'import type { '+[...externalTypes].sort().map(n=>n+' as Model'+n).join(', ')+' } from \'./model-contracts.js\';\n':'';
const contracts=header+imports+declarations;
const runtime=header+'export const '+constant+'_SCHEMA_DIGEST = '+JSON.stringify(sha)+';\nexport const '+constant+'_SCHEMA = '+JSON.stringify(schema,null,2)+' as const;\n';
assert(process.argv.length===2||process.argv.length===3&&process.argv[2]==='--check','Only --check is supported');
for(const [name,content] of [['contracts.ts',contracts],['schema.ts',runtime]]){
  const path=new URL('../src/native-v2/'+prefix+name,import.meta.url);
  if(process.argv.includes('--check'))assert.equal(readFileSync(path,'utf8'),content,'Native v2 generated contract drift: '+name);
  else{mkdirSync(new URL('../src/native-v2/',import.meta.url),{recursive:true});writeFileSync(path,content);}
}
}
