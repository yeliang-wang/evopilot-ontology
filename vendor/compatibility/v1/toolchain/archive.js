import { gunzipSync, inflateRawSync } from 'node:zlib';
import path from 'node:path';
const MAX_BYTES = 512 * 1024 * 1024;
function reject(message) { throw new Error('TOOLCHAIN_ARCHIVE: ' + message); }
export function archivePath(value) {
    const clean = value.replace(/\/$/, '');
    if (!clean || clean.includes('\\') || clean.startsWith('/') || clean.includes(':') || /[\u0000-\u001f]/.test(clean)
        || clean.split('/').some(p => !p || p === '.' || p === '..'))
        reject('unsafe path');
    return clean;
}
function text(bytes) { return bytes.toString('utf8').replace(/\0.*$/s, ''); }
function octal(bytes) {
    const s = text(bytes).trim();
    if (s && !/^[0-7]+$/.test(s))
        reject('non-octal tar value');
    const n = parseInt(s || '0', 8);
    if (!Number.isSafeInteger(n) || n < 0 || n > MAX_BYTES)
        reject('tar number limit');
    return n;
}
function pax(bytes) {
    const fields = {};
    let offset = 0;
    while (offset < bytes.length) {
        const space = bytes.indexOf(32, offset), length = Number(bytes.subarray(offset, space).toString());
        if (space < offset || !Number.isSafeInteger(length) || length <= space - offset + 2 || offset + length > bytes.length)
            reject('pax bounds');
        const row = bytes.subarray(space + 1, offset + length - 1).toString('utf8'), eq = row.indexOf('=');
        if (eq < 1 || bytes[offset + length - 1] !== 10)
            reject('pax field');
        fields[row.slice(0, eq)] = row.slice(eq + 1);
        offset += length;
    }
    return fields;
}
/** Parse only the pinned distribution formats. No archive member executes. */
export function readTarGz(compressed) {
    const bytes = gunzipSync(compressed, { maxOutputLength: MAX_BYTES });
    const files = [], links = [], names = new Set();
    let offset = 0, extended = {}, globals = {};
    while (offset + 512 <= bytes.length) {
        const h = bytes.subarray(offset, offset + 512);
        offset += 512;
        if (h.every(v => v === 0))
            break;
        const expected = octal(h.subarray(148, 156));
        const sum = h.reduce((s, v, i) => s + (i >= 148 && i < 156 ? 32 : v), 0);
        if (sum !== expected)
            reject('tar header checksum');
        const size = octal(h.subarray(124, 136));
        if (offset + size > bytes.length)
            reject('truncated tar');
        const data = bytes.subarray(offset, offset + size);
        offset += Math.ceil(size / 512) * 512;
        const type = String.fromCharCode(h[156] || 48);
        if (type === 'x') {
            extended = pax(data);
            continue;
        }
        if (type === 'g') {
            globals = { ...globals, ...pax(data) };
            continue;
        }
        const metadata = { ...globals, ...extended };
        extended = {};
        if (metadata.size !== undefined && Number(metadata.size) !== size)
            reject('pax size mismatch');
        const prefix = text(h.subarray(345, 500));
        const name = archivePath(metadata.path ?? ((prefix ? prefix + '/' : '') + text(h.subarray(0, 100))));
        if (names.has(name) || names.size >= 20000)
            reject('duplicate tar member/limit');
        names.add(name);
        if (type === '5')
            continue;
        if (type === '2') {
            const target = metadata.linkpath ?? text(h.subarray(157, 257));
            if (!target || path.posix.isAbsolute(target) || target.includes('\\'))
                reject('unsafe tar link');
            archivePath(path.posix.normalize(path.posix.join(path.posix.dirname(name), target)));
            links.push({ path: name, target });
        }
        else if (type === '0')
            files.push({ path: name, bytes: Buffer.from(data), mode: octal(h.subarray(100, 108)) & 0o777 });
        else
            reject('unsupported tar member type ' + type);
    }
    if (!files.length)
        reject('empty tar');
    for (const link of links) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(link.path), link.target));
        if (!names.has(target) || files.some(f => f.path.startsWith(link.path + '/')))
            reject('dangling or parent tar link');
    }
    return { files, links };
}
/** Wheels in the fixed lock are ordinary pure-Python ZIPs, never executable installers. */
export function readWheel(bytes) {
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
            end = i;
            break;
        }
    }
    if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
        reject('ZIP end/multidisk');
    const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
    if (!count || count > 10000 || start + size !== end)
        reject('ZIP directory bounds');
    let offset = start, total = 0;
    const files = [], names = new Set();
    for (let i = 0; i < count; i++) {
        if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
            reject('ZIP directory');
        const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
        const compressedSize = bytes.readUInt32LE(offset + 20), originalSize = bytes.readUInt32LE(offset + 24);
        const n = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
        const mode = bytes.readUInt32LE(offset + 38) >>> 16, local = bytes.readUInt32LE(offset + 42);
        const nameBytes = bytes.subarray(offset + 46, offset + 46 + n), name = archivePath(nameBytes.toString('utf8'));
        if (offset + 46 + n + extra + comment > end || flags & 1 || ![0, 8].includes(method) || (mode & 0o170000) === 0o120000)
            reject('unsupported ZIP entry');
        offset += 46 + n + extra + comment;
        if (names.has(name) || name.includes('.data/') || name.endsWith('.pth'))
            reject('unsafe/duplicate wheel entry');
        names.add(name);
        if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50)
            reject('ZIP local header');
        const localNameSize = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28);
        if (!bytes.subarray(local + 30, local + 30 + localNameSize).equals(nameBytes))
            reject('ZIP path disagreement');
        const begin = local + 30 + localNameSize + localExtra;
        if (begin + compressedSize > start || originalSize > 32 * 1024 * 1024)
            reject('ZIP entry bounds');
        const raw = bytes.subarray(begin, begin + compressedSize);
        const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: 32 * 1024 * 1024 });
        total += data.length;
        if (data.length !== originalSize || total > 128 * 1024 * 1024)
            reject('ZIP expanded size');
        if (!nameBytes.toString().endsWith('/'))
            files.push({ path: name, bytes: data, mode: 0o644 });
    }
    if (offset !== end || !files.length)
        reject('ZIP trailing directory');
    return files;
}
