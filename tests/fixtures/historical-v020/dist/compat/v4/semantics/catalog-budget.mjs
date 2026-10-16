import {setImmediate as yieldTurn} from "node:timers/promises";
import {requireSupply, supplyError, supplyLimits} from "./catalog-contract.mjs";

// Internal Engine context, never a document/configuration-supplied callback.
// One deadline spans preparation, policy reads and all nested store operations.
export function createSupplyBudget(overrides, signal) {
  const limits = supplyLimits(overrides);
  const deadline = performance.now() + limits.readTimeoutMilliseconds;
  let stopped;
  const stop = code => { stopped ??= supplyError(code); return stopped; };
  const check = () => {
    if (stopped) throw stopped;
    if (signal?.aborted) throw stop("CANCELLED");
    if (performance.now() >= deadline) throw stop("TIMEOUT");
  };
  check.wait = async invoke => {
    check();
    let timer;
    let abort;
    const boundary = new Promise((_, reject) => {
      timer = setTimeout(() => reject(stop("TIMEOUT")), Math.max(1, deadline - performance.now()));
      abort = () => reject(stop("CANCELLED"));
      signal?.addEventListener("abort", abort, {once: true});
    });
    try {
      const value = await Promise.race([Promise.resolve().then(() => {check(); return invoke();}), boundary]);
      check(); // Also catch synchronous callback overruns before returning success.
      return value;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  };
  // Yield only at safe checkpoints, never detach a mutation on timeout.
  check.yield = async () => { check(); await yieldTurn(); check(); };
  check.remaining = () => { check(); return Math.max(0, deadline - performance.now()); };
  Object.defineProperty(check, "limits", {value: limits});
  requireSupply(typeof signal?.aborted === "boolean" || signal === undefined, "BUDGET_INVALID");
  check();
  return Object.freeze(check);
}
