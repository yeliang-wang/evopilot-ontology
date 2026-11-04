import { canonical, hashBytes } from '../standalone/validation.js';
import { fail } from '../standalone/types.js';
import type { Json } from '../standalone/types.js';

export const METADATA_INLINE_BYTES = 256 * 1024;
export const METADATA_PAGE_BYTES = 65536;

/** A stable projection excludes mutable heads/freshness. Readers pin this
 * digest and the original asset identity, then recheck freshness separately. */
export function metadataProjection(value: Json) {
  const bytes = Buffer.from(canonical(value));
  return {bytes, projectionDigest:hashBytes(bytes)};
}
export function metadataPointer(projection:ReturnType<typeof metadataProjection>,operation:string,inline:boolean):Json {
  return {schema:'ontology-metadata-pointer/v1',operation,projectionDigest:projection.projectionDigest,
    bytes:projection.bytes.length,encoding:'canonical-json-utf8',maxBytes:METADATA_PAGE_BYTES,inline};
}
export function metadataPage(projection:ReturnType<typeof metadataProjection>,expectedDigest:string,offset:unknown,maxBytes:unknown):Json {
  if(projection.projectionDigest!==expectedDigest)fail('METADATA_CONFLICT','Metadata projection differs from the pinned digest',409);
  if(!Number.isSafeInteger(offset)||(offset as number)<0||!Number.isSafeInteger(maxBytes)||(maxBytes as number)<4||(maxBytes as number)>METADATA_PAGE_BYTES)fail('INVALID_INPUT','Metadata offset and 4–65536 byte page size required');
  const {bytes}=projection,start=offset as number;
  if(start>bytes.length||start<bytes.length&&(bytes[start]&0xc0)===0x80)fail('INVALID_INPUT','Metadata offset splits UTF-8 or exceeds projection');
  let end=Math.min(bytes.length,start+(maxBytes as number));
  while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;
  return {projectionDigest:projection.projectionDigest,bytes:bytes.length,encoding:'canonical-json-utf8',
    startByte:start,endByte:end,content:bytes.subarray(start,end).toString('utf8'),
    nextOffset:end===bytes.length?null:end,complete:end===bytes.length};
}
