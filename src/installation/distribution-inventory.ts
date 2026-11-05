import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {inspectDistribution} from './distribution-inspect.js';
import {selectedDistribution} from './distribution-catalog.js';
import {validateDistributionInput,validateDistributionManifest,DISTRIBUTION_LIMITS} from './distribution-contract.js';
import type {DistributionManifest} from './distribution-contract.js';
import {inspectTarArchive} from './distribution-archive.js';
import type {ArchiveInventory} from './distribution-archive.js';
import {hash,object} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

const PACKAGE_ROOT=fileURLToPath(new URL('../../',import.meta.url));
const BUNDLES=['linux-arm64-temurin21-pbs20260211-candidate1','linux-arm64-temurin21-pbs20260211-candidate2','linux-arm64-temurin21-pbs20260211-candidate3','linux-arm64-temurin21-pbs20260211-candidate4'];
// These transforms are product code, never inferred from an archive or supplied
// by an operator. The outer wheel tar is inventoried; its ZIP members are not.
const RECIPES=Object.freeze([
  {artifactId:'dl-payload',role:'dl',format:'tar.gz',stripPrefix:'dl',maximumEntries:256},
  {artifactId:'java-runtime',role:'java',format:'tar.gz',stripPrefix:'jdk-21.0.13+9-jre',maximumEntries:512},
  {artifactId:'python-runtime',role:'python',format:'tar.gz',stripPrefix:'python',maximumEntries:10000},
  {artifactId:'python-wheels',role:'python',format:'tar',stripPrefix:null,maximumEntries:64},
] as const);

export interface PayloadArchiveInventory {
  artifactId:string;
  role:string;
  stripPrefix:string|null;
  inventory:ArchiveInventory;
}

/** Internal composition seam; the public entry selects the executing package's
 * catalog before reaching it. No caller-defined preparation recipes exist. */
export async function inspectPayloadArchiveInventories(bundleRoot:string,manifest:DistributionManifest):Promise<PayloadArchiveInventory[]> {
  validateDistributionManifest(manifest);
  if(!BUNDLES.includes(manifest.id))fail('NO_DISTRIBUTION_RECIPE','No product-owned payload recipe matches this distribution',404);
  const results:PayloadArchiveInventory[]=[],deadline=performance.now()+60000;
  for(const recipe of RECIPES){
    const artifact=manifest.artifacts.find(a=>a.id===recipe.artifactId),component=manifest.components.find(c=>c.role===recipe.role);
    if(!artifact||!component?.artifactIds.includes(recipe.artifactId)||artifact.format!==recipe.format)fail('DISTRIBUTION_RECIPE_MISMATCH','Packaged artifact selection differs from its payload recipe',409);
    const remaining=Math.floor(deadline-performance.now());
    if(remaining<1)fail('DISTRIBUTION_ARCHIVE_TIMEOUT','Payload archive inventory exceeded its aggregate time budget',503);
    const entries=Math.min(component.declaredEntries,recipe.maximumEntries);
    const expanded=recipe.artifactId==='python-wheels'?Math.min(component.declaredExpandedBytes,16*1024*1024):component.declaredExpandedBytes;
    const inventory=await inspectTarArchive(join(bundleRoot,artifact.filename),{
      format:recipe.format,bytes:artifact.bytes,digest:artifact.digest,stripPrefix:recipe.stripPrefix,
      maxEntries:entries,maxFileBytes:Math.min(expanded,DISTRIBUTION_LIMITS.artifactBytes),maxExpandedBytes:expanded,
      maxTarBytes:expanded+(entries+16)*1024+1024*1024,timeoutMs:remaining,
    });
    results.push({artifactId:recipe.artifactId,role:recipe.role,stripPrefix:recipe.stripPrefix,inventory});
  }
  for(const component of manifest.components){
    const rows=results.filter(row=>row.role===component.role);
    if(rows.reduce((n,row)=>n+row.inventory.fileBytes,0)>component.declaredExpandedBytes||rows.reduce((n,row)=>n+row.inventory.entryCount,0)>component.declaredEntries)fail('DISTRIBUTION_ARCHIVE_LIMIT','Combined payload inventories exceed their component budget',413);
  }
  return results;
}

/** Read-only raw + tar inventory. It is deliberately not a prepare/resume
 * operation: it creates no lease, directories, executable or tool binding. */
export async function inspectDistributionInventory(value:unknown):Promise<Json> {
  validateDistributionInput(value);
  const initial=inspectDistribution(value);object(initial);object(initial.report);
  const selected=selectedDistribution(realpathSync(PACKAGE_ROOT),value.bundleId);
  if(initial.report.manifestDigest!==selected.manifestDigest)fail('DISTRIBUTION_CATALOG_CHANGED','Selected catalog changed before payload inspection',409);
  const inventories=await inspectPayloadArchiveInventories(value.bundleRoot,selected.manifest);
  // Recheck the complete bundle, selected package and destination observations
  // after asynchronous reads. Neither observation is a future mutation lease.
  const final=inspectDistribution(value);object(final);object(final.report);
  if(final.report.manifestDigest!==selected.manifestDigest||final.report.nodeDigest!==initial.report.nodeDigest)fail('DISTRIBUTION_INSPECTION_CHANGED','Runtime or catalog changed during payload inventory',409);
  const archiveInventories=inventories as unknown as Json;
  const recipe={schema:'ontology-distribution-payload-recipes/v1',bundleId:selected.manifest.id,recipes:RECIPES} as unknown as Json;
  const report={
    ...final.report,schema:'ontology-distribution-inventory-report/v1',
    rawInspectionDigest:final.reportDigest,
    payloadRecipeDigest:hash(recipe),payloadRecipeScope:'TAR_INVENTORY_ONLY',
    payloadTarInventories:archiveInventories,payloadTarInventoryDigest:hash(archiveInventories),
    payloadTarInventoryObserved:true,expandedInventoryObserved:false,
    caseSensitiveTargetRequired:true,targetFilesystemSemanticsVerified:false,
    wheelZipContentsObserved:false,sourceArchivesExpanded:false,extractionPerformed:false,
    remainingPreparation:['Inspect and unpack pinned wheel ZIP members','Verify target filesystem semantics and owned write paths','Durable exact-request admission, resume, status and abort','Create Python environment at its final absolute path','Verify actual executables and generate toolchain manifests','Explicitly bind tools to the selected installation'],
    authority:false,
  };
  return {report:report as unknown as Json,reportDigest:hash(report as unknown as Json),authority:false};
}
