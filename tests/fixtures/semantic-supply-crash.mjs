import fs from "node:fs/promises";
import path from "node:path";
import {semanticCatalogOperation} from "../../src/compat/v4/semantics/catalog-supply.mjs";

// Synthetic crash injection only: production exposes no fault-injection switch.
const [home, stage] = process.argv.slice(2);
const request = JSON.parse(await fs.readFile(path.join(home, "fixture-request.json"), "utf8"));
const rename = fs.rename;
const mkdir = fs.mkdir;
const open = fs.open;
const rmdir = fs.rmdir;
fs.mkdir = async (directory, ...args) => {
  const result = await mkdir(directory, ...args);
  if (stage === "recovery-after-guard" && path.basename(directory) === "recovery.lock") process.exit(88);
  return result;
};
fs.open = async (file, ...args) => {
  if (stage === "before-generation" && String(file).includes("/semantic-catalog/generations/")) process.exit(92);
  const handle = await open(file, ...args);
  if (stage === "after-generation" && String(file).includes("/semantic-catalog/generations/")) {
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {await sync(); process.exit(93);};
  }
  if (stage === "recovery-after-receipt" && String(file).includes("/semantic-catalog/recoveries/")) {
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {await sync(); process.exit(89);};
  }
  return handle;
};
fs.rmdir = async (...args) => {
  if (stage === "recovery-cleanup-failure" && path.basename(args[0]) === "recovery.lock") throw Object.assign(new Error("synthetic cleanup failure"), {code: "EIO"});
  return rmdir(...args);
};
fs.rename = async (from, to) => {
  const pointerSwitch = path.basename(to) === "SEMANTIC-CATALOG.json";
  if (pointerSwitch && stage === "before-pointer") process.exit(86);
  if (stage === "unlock-failure" && path.basename(from) === "publication.lock") throw Object.assign(new Error("synthetic unlock failure"), {code: "EIO"});
  const recoveryMove = String(to).includes("/semantic-catalog/recovered-locks/");
  if (recoveryMove && stage === "recovery-before-move") process.exit(90);
  await rename(from, to);
  if (recoveryMove && stage === "recovery-after-move") process.exit(91);
  if (pointerSwitch && stage === "after-pointer") process.exit(87);
};
try { await semanticCatalogOperation(request); }
catch (error) { process.stdout.write(JSON.stringify({code: error.code})); process.exitCode = 1; }
