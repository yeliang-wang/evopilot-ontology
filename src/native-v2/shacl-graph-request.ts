import type {SHACLRequest} from './shacl-contracts.js';

// Graph inspection cannot satisfy the independently covered lifecycle suite.
export type SHACLGraphRequest=Omit<SHACLRequest,'schema'|'expectations'>&{readonly schema:'ontology-shacl-graph-request/v2'};
export {validateSHACLGraphRequest} from './shacl-request.js';
