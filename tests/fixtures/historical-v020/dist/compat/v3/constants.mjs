import path from "node:path";

// Own product root; no legacy installation or environment lookup.
export const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../../..");
