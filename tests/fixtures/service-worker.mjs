import { createOntologyService } from '../../src/service.mjs';
import { DatabaseSync } from 'node:sqlite';

// Test-only interception: actual service transaction reaches COMMIT after writing
// state, receipt and audit. No hook exists in product options, RPC, or environment.
process.on('message', message => {
  try {
    const service = createOntologyService(message.options); service.initialize();
    if (message.killBeforeCommit) {
      const exec = DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec = function (sql) {
        if (sql === 'COMMIT') {
          process.send({ precommit: true });
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        return exec.call(this, sql);
      };
    }
    const result = service.execute(message.request); service.close();
    process.send({ result }, () => process.disconnect());
  } catch (error) { process.send({ error: error.code || error.message }, () => process.disconnect()); }
});
