import { constants, openSync, closeSync, fstatSync, readSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nativeAssertJSON, nativeBytesDigest, nativeDigest, nativeExact, nativeStableSerialize, nativeText } from './native.mjs';
function fail(message) {
    throw Object.assign(new Error(message), { code: 'HUMAN_EVIDENCE_REQUIRED' });
}
/** No network fetches, opaque labels, links, or unpinned mutable files. */
function readPinned(reference) {
    nativeText(reference);
    let url;
    try {
        url = new URL(reference);
    }
    catch {
        return fail('A pinned local evidence file URL is required');
    }
    if (url.protocol !== 'file:' || url.host || url.search || !/^#sha256=[a-f0-9]{64}$/.test(url.hash))
        fail('A pinned local evidence file URL is required');
    const expected = 'sha256:' + url.hash.slice(8);
    url.hash = '';
    const filename = fileURLToPath(url);
    let fd;
    try {
        if (realpathSync(filename) !== filename)
            fail('Evidence links are not allowed');
        fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size < 1 || stat.size > 1048576)
            fail('Evidence must be a bounded regular file');
        const buffer = Buffer.alloc(stat.size + 1);
        let length = 0;
        while (length < buffer.length) {
            const count = readSync(fd, buffer, length, buffer.length - length, null);
            if (count === 0)
                break;
            length += count;
        }
        const bytes = buffer.subarray(0, length);
        if (length !== stat.size || nativeBytesDigest(bytes) !== expected)
            fail('Evidence bytes differ from the approved reference');
        return bytes;
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'HUMAN_EVIDENCE_REQUIRED')
            throw error;
        return fail('Pinned human evidence is missing or unreadable');
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
    }
}
export function verifyDecisionEvidence(reference, expected) {
    try {
        nativeAssertJSON(expected);
        nativeExact(expected, ['owner', 'operation', 'workspaceId', 'scope', 'reviewDigest', 'decision']);
        nativeExact(expected.scope, ['visibility', 'projectId']);
        nativeDigest(expected.reviewDigest);
        const value = JSON.parse(readPinned(reference).toString('utf8'));
        nativeAssertJSON(value);
        nativeExact(value, ['schema', 'subject', 'source']);
        if (value.schema !== 'evopilot-decision-evidence/v1' || nativeStableSerialize(value.subject) !== nativeStableSerialize(expected))
            fail('Human evidence does not bind this exact decision');
        nativeExact(value.source, ['reference', 'description']);
        nativeText(value.source.reference);
        nativeText(value.source.description);
        readPinned(value.source.reference);
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'HUMAN_EVIDENCE_REQUIRED')
            throw error;
        fail('Invalid human decision evidence');
    }
}
