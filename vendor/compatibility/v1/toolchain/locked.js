import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readTarGz, readWheel, archivePath } from './archive.js';
import { nativeSha256 } from '../native.mjs';
const lockFile = fileURLToPath(new URL('./toolchain.lock.json', import.meta.url));
const sha = (value) => createHash('sha256').update(value).digest('hex');
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function absolute(value) {
    if (!path.isAbsolute(value) || path.normalize(value) !== value)
        fail('TOOLCHAIN_PATH', 'Expected normalized absolute directory');
    return value;
}
function controlledDirectory(directory, create = false) {
    absolute(directory);
    if (create)
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    let current = path.parse(directory).root;
    for (const part of directory.split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        const stat = fs.lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink())
            fail('TOOLCHAIN_PATH', 'Directory ancestry contains a link');
    }
    const stat = fs.statSync(directory);
    if (stat.uid !== process.getuid() || (stat.mode & 0o022))
        fail('TOOLCHAIN_PATH', 'Toolchain directory is not owner-controlled');
}
function regular(filename, maximum = 256 * 1024 * 1024) {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximum || stat.uid !== process.getuid() || (stat.mode & 0o022))
        fail('TOOLCHAIN_INTEGRITY', 'Unsafe toolchain file');
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(fd);
        if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size)
            fail('TOOLCHAIN_INTEGRITY', 'Toolchain file changed');
        return fs.readFileSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
}
function readLock() {
    const bytes = regular(lockFile, 1024 * 1024), lock = JSON.parse(bytes.toString());
    if (lock.schema !== 'evopilot-toolchain-lock/v1' || lock.productVersion !== '0.3.0')
        fail('TOOLCHAIN_LOCK', 'Unsupported bundled lock');
    const platformKey = process.platform + '-' + process.arch, platform = lock.platforms[platformKey];
    if (!platform)
        fail('TOOLCHAIN_UNSUPPORTED_PLATFORM', 'Native toolchain is not verified on ' + platformKey);
    if (platform.platform !== process.platform || platform.arch !== process.arch)
        fail('TOOLCHAIN_LOCK', 'Platform identity mismatch');
    for (const asset of [...platform.artifacts, ...lock.pythonDependencies]) {
        if (!/^[a-f0-9]{64}$/.test(asset.sha256) || !asset.url.startsWith('https://'))
            fail('TOOLCHAIN_LOCK', 'Invalid locked download');
    }
    for (const license of lock.licenses) {
        const content = regular(path.join(path.dirname(lockFile), archivePath(license.path)), 1024 * 1024);
        if (sha(content) !== license.sha256)
            fail('TOOLCHAIN_LOCK', 'License content mismatch');
    }
    return { lock, platform, platformKey, lockDigest: 'sha256:' + sha(bytes) };
}
export function inspectBundledToolchainLock() {
    const { lock, platform, platformKey, lockDigest } = readLock();
    return { schema: lock.schema, productVersion: lock.productVersion, platform: platformKey, lockDigest,
        versions: { ...platform.versions }, limits: { ...lock.limits }, supportedPlatforms: Object.keys(lock.platforms) };
}
function cacheFile(directory, asset) {
    const bytes = regular(path.join(directory, asset.sha256));
    if (sha(bytes) !== asset.sha256 || ((asset.bytes ?? asset.size) !== undefined && bytes.length !== (asset.bytes ?? asset.size)))
        fail('TOOLCHAIN_INTEGRITY', 'Downloaded bytes differ from bundled lock');
    return bytes;
}
async function download(directory, asset, mirror, offline) {
    const destination = path.join(directory, asset.sha256);
    if (fs.existsSync(destination)) {
        cacheFile(directory, asset);
        return;
    }
    let bytes;
    if (mirror && fs.existsSync(path.join(mirror, asset.sha256)))
        bytes = cacheFile(mirror, asset);
    else {
        if (offline)
            fail('TOOLCHAIN_NOT_READY', 'Offline cache is missing a locked artifact');
        try {
            // This budget covers the complete body, including the 62 MB locked OPA
            // binary. A one-minute deadline repeatedly aborts valid slow transfers.
            const response = await fetch(asset.url, { signal: AbortSignal.timeout(300_000), redirect: 'follow' });
            if (!response.ok || !response.body || !response.url.startsWith('https://'))
                fail('TOOLCHAIN_DOWNLOAD', 'Locked artifact download failed');
            const chunks = [];
            let size = 0;
            for await (const value of response.body) {
                const b = Buffer.from(value);
                size += b.length;
                if (size > (asset.bytes ?? asset.size ?? 256 * 1024 * 1024))
                    fail('TOOLCHAIN_DOWNLOAD', 'Download exceeded locked bound');
                chunks.push(b);
            }
            bytes = Buffer.concat(chunks);
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'TOOLCHAIN_DOWNLOAD')
                throw error;
            // Keep a failed dependency download distinct from a daemon/Workspace error.
            // Never return fetch causes, redirect URLs or proxy details through MCP.
            const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
            fail(timeout ? 'TOOLCHAIN_DOWNLOAD_TIMEOUT' : 'TOOLCHAIN_DOWNLOAD_NETWORK', timeout ? 'Locked artifact download timed out' : 'Locked artifact download failed before completion');
        }
    }
    if (sha(bytes) !== asset.sha256 || ((asset.bytes ?? asset.size) !== undefined && bytes.length !== (asset.bytes ?? asset.size)))
        fail('TOOLCHAIN_INTEGRITY', 'Download hash/size mismatch');
    fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 });
}
function expectedFiles(platform, lock, downloads) {
    const files = [], links = [];
    for (const artifact of platform.artifacts) {
        const bytes = cacheFile(downloads, artifact);
        if (artifact.format === 'raw')
            files.push({ path: archivePath(artifact.destination), bytes, mode: 0o755 });
        else {
            const contents = readTarGz(bytes), prefix = artifact.destination === '.' ? '' : archivePath(artifact.destination) + '/';
            files.push(...contents.files.map(f => ({ ...f, path: prefix + f.path })));
            links.push(...contents.links.map(l => ({ ...l, path: prefix + l.path })));
        }
    }
    for (const wheel of lock.pythonDependencies)
        files.push(...readWheel(cacheFile(downloads, wheel)).map(f => ({ ...f, path: platform.pythonSite + '/' + f.path })));
    const names = new Set();
    for (const item of [...files, ...links]) {
        archivePath(item.path);
        if (names.has(item.path))
            fail('TOOLCHAIN_LOCK', 'Locked artifacts overlap');
        names.add(item.path);
    }
    return { files, links };
}
function installedRoot(options, lockDigest, platformKey) {
    return path.join(absolute(options.cacheRoot), lockDigest.slice(7), platformKey);
}
function cleanEnvironment(root) {
    return { PATH: '/usr/bin:/bin', HOME: root, LANG: 'C.UTF-8', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' };
}
function tree(root, prefix = '') {
    const result = [];
    for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
        const rel = prefix ? prefix + '/' + name : name, s = fs.lstatSync(path.join(root, rel));
        if (s.isDirectory() && !s.isSymbolicLink())
            result.push(...tree(root, rel));
        else
            result.push(rel);
    }
    return result;
}
function assertTree(root, prefix, expected) {
    for (const rel of tree(path.join(root, prefix))) {
        if (!expected.has(prefix + '/' + rel))
            fail('TOOLCHAIN_INTEGRITY', 'Unexpected executable dependency: ' + prefix + '/' + rel);
    }
}
/** Reconstruct expected bytes from pinned archives; an editable inventory is never trust evidence. */
export function inspectNativeToolchain(options) {
    const { lock, platform, platformKey, lockDigest } = readLock();
    const environmentRoot = installedRoot(options, lockDigest, platformKey), downloads = path.join(options.cacheRoot, 'downloads');
    if (!fs.existsSync(environmentRoot) || !fs.existsSync(downloads))
        fail('TOOLCHAIN_NOT_READY', 'Prepare the native toolchain before validation');
    controlledDirectory(environmentRoot);
    controlledDirectory(downloads);
    const { files, links } = expectedFiles(platform, lock, downloads), names = new Set([...files, ...links].map(f => f.path));
    const dependencyFiles = files.map(file => {
        const filename = path.join(environmentRoot, file.path), expected = sha(file.bytes);
        controlledDirectory(path.dirname(filename));
        if (sha(regular(filename)) !== expected)
            fail('TOOLCHAIN_INTEGRITY', 'Locked dependency differs: ' + file.path);
        return { path: filename, sha256: expected };
    });
    for (const link of links) {
        const filename = path.join(environmentRoot, link.path);
        if (!fs.lstatSync(filename).isSymbolicLink() || fs.readlinkSync(filename) !== link.target || !fs.realpathSync(filename).startsWith(environmentRoot + path.sep))
            fail('TOOLCHAIN_INTEGRITY', 'Locked link differs');
    }
    for (const prefix of ['python', 'conftest', 'bin', platform.pythonSite])
        assertTree(environmentRoot, prefix, names);
    // The standard venv configuration is bound to this base interpreter, never global packages.
    const cfgPath = path.join(environmentRoot, 'venv/pyvenv.cfg'), cfg = regular(cfgPath, 16384);
    const fields = Object.fromEntries(cfg.toString().trim().split('\n').map(row => { const i = row.indexOf(' = '); if (i < 1)
        fail('TOOLCHAIN_INTEGRITY', 'Malformed venv configuration'); return [row.slice(0, i), row.slice(i + 3)]; }));
    if (Object.keys(fields).sort().join('|') !== 'command|executable|home|include-system-site-packages|version'
        || fields.home !== path.join(environmentRoot, path.dirname(platform.pythonBase)) || fields['include-system-site-packages'] !== 'false'
        || fields.version !== platform.versions.python || fields.executable !== path.join(environmentRoot, platform.pythonBase)
        || fields.command !== `${path.join(environmentRoot, platform.pythonBase)} -m venv --without-pip ${path.join(environmentRoot, 'venv')}`)
        fail('TOOLCHAIN_INTEGRITY', 'Venv configuration is not isolated');
    dependencyFiles.push({ path: cfgPath, sha256: sha(cfg) });
    const tools = Object.fromEntries(Object.entries(platform.tools).map(([name, tool]) => {
        const executable = path.join(environmentRoot, tool.executable), resolved = fs.realpathSync(executable);
        if (!resolved.startsWith(environmentRoot + path.sep) || sha(regular(resolved)) !== tool.sha256)
            fail('TOOLCHAIN_INTEGRITY', 'Tool binary differs: ' + name);
        return [name, { executable, version: tool.version, sha256: tool.sha256 }];
    }));
    tools.pyshacl = { ...tools.python, version: platform.versions.pyshacl };
    return { schema: 'evopilot-native-toolchain/v1', lockDigest, platform: process.platform, arch: process.arch, tools,
        dependencyLockDigest: nativeSha256(dependencyFiles), environmentRoot, dependencyFiles, ...lock.limits };
}
/** Explicit installer step. Validation/doctor never performs a network download. */
export async function prepareNativeToolchain(options) {
    const { lock, platform, platformKey, lockDigest } = readLock();
    controlledDirectory(options.cacheRoot, true);
    if (options.downloadCache)
        controlledDirectory(options.downloadCache);
    const downloads = path.join(options.cacheRoot, 'downloads');
    controlledDirectory(downloads, true);
    for (const artifact of [...platform.artifacts, ...lock.pythonDependencies])
        await download(downloads, artifact, options.downloadCache, options.offline === true);
    const environmentRoot = installedRoot(options, lockDigest, platformKey);
    if (fs.existsSync(environmentRoot))
        return inspectNativeToolchain(options);
    const { files, links } = expectedFiles(platform, lock, downloads);
    controlledDirectory(path.dirname(environmentRoot), true);
    const stage = environmentRoot + '.stage-' + randomUUID();
    fs.mkdirSync(stage, { mode: 0o700 });
    let ownsRoot = false;
    try {
        for (const file of files.filter(f => !f.path.startsWith(platform.pythonSite + '/'))) {
            const filename = path.join(stage, file.path);
            fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
            fs.writeFileSync(filename, file.bytes, { flag: 'wx', mode: file.mode & 0o755 });
        }
        for (const link of links) {
            const filename = path.join(stage, link.path);
            fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
            fs.symlinkSync(link.target, filename);
        }
        // An existing installation is never repaired in place or replaced by a racing installer.
        fs.mkdirSync(environmentRoot, { mode: 0o700 });
        ownsRoot = true;
        for (const name of fs.readdirSync(stage))
            fs.renameSync(path.join(stage, name), path.join(environmentRoot, name));
        const base = path.join(environmentRoot, platform.pythonBase);
        const result = spawnSync(base, ['-I', '-B', '-m', 'venv', '--without-pip', path.join(environmentRoot, 'venv')], { env: cleanEnvironment(environmentRoot), cwd: environmentRoot, timeout: 60_000, maxBuffer: 1024 * 1024 });
        if (result.error || result.status !== 0)
            fail('TOOLCHAIN_PREPARE', 'Isolated Python environment creation failed');
        for (const file of files.filter(f => f.path.startsWith(platform.pythonSite + '/'))) {
            const filename = path.join(environmentRoot, file.path);
            fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
            fs.writeFileSync(filename, file.bytes, { flag: 'wx', mode: 0o600 });
        }
        const toolchain = inspectNativeToolchain(options);
        const probe = spawnSync(toolchain.tools.python.executable, ['-I', '-B', '-c', 'import importlib.metadata as m,json; print(json.dumps({n:m.version(n) for n in ' + JSON.stringify(lock.pythonDependencies.map(d => d.name)) + '},sort_keys=True))'], { env: cleanEnvironment(environmentRoot), cwd: environmentRoot, timeout: 30_000, maxBuffer: 1024 * 1024 });
        const versions = probe.status === 0 ? JSON.parse(probe.stdout.toString()) : null;
        if (probe.error || !versions || lock.pythonDependencies.some(d => versions[d.name] !== d.version))
            fail('TOOLCHAIN_PREPARE', 'Python dependency identity check failed');
        return inspectNativeToolchain(options);
    }
    catch (error) {
        if (ownsRoot)
            fs.rmSync(environmentRoot, { recursive: true, force: true });
        throw error;
    }
    finally {
        fs.rmSync(stage, { recursive: true, force: true });
    }
}
