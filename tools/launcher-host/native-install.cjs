#!/usr/bin/env node
'use strict';
/* Pick a lane-3 native Home variant and put it on a TV.
 *
 *   node native-install.cjs list
 *   node native-install.cjs install <variant> --model <id> --host <ip> [--force] [--no-watcher]
 *   node native-install.cjs rollback --model <id> --host <ip> [--no-watcher]
 *   node native-install.cjs status   --model <id> --host <ip>
 *
 * Why a CLI and not a page on the TV: lane 3 replaces the thing a picker would
 * live in. If a variant renders badly, a picker inside the native Home is
 * unreachable. The picker has to sit outside the swapped component, so this is
 * a host-side tool over the root SSH lane. A bridge-served page can drive the
 * same functions later.
 *
 * Safety rules, all enforced here:
 *   - a variant is only offered for a build it has actually run on; --force
 *     overrides that, loudly.
 *   - the stock bundle is pulled from the TV and verified against the model
 *     profile before anything is written.
 *   - the stock backup is taken once, by bootstrap, and is never replaced by a
 *     variant switch. Rollback therefore works whichever variant is installed.
 *   - the installer owns the bridge watcher: install/switch disable it, and
 *     rollback restores the pre-native config, which is backed up once and
 *     never replaced. A native Home and the watcher are exclusive; --no-watcher
 *     skips this, loudly, for an operator who runs the canvas launcher.
 *   - every build states the stock sha256 it targets.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { hash, CONFIG } = require('./native-trial.cjs');

const HERE = __dirname;
const REPO = path.resolve(HERE, '../..');
const VARIANTS = JSON.parse(fs.readFileSync(path.join(HERE, 'variants.json'), 'utf8'));
const MODELS = JSON.parse(fs.readFileSync(path.join(HERE, 'models.json'), 'utf8'));

function variant(id) {
  const found = VARIANTS.variants.filter(v => v.id === id)[0];
  if (!found) {
    throw new Error('unknown variant: ' + id + ' (try: ' +
      VARIANTS.variants.map(v => v.id).join(', ') + ')');
  }
  return found;
}

function model(id) {
  const found = MODELS.models[id];
  if (!found) {
    throw new Error('unknown model: ' + id + ' (try: ' +
      Object.keys(MODELS.models).join(', ') + ')');
  }
  return found;
}

function verified(v, m) {
  return (v.verified || []).some(entry => entry.model === m.name.split(' / ')[0]);
}

function checkPair(v, m, force) {
  if (verified(v, m)) return;
  const where = (v.verified || []).map(e => e.model + ' / ' + e.firmware).join(', ') || 'nowhere yet';
  const message = v.name + ' has not been verified on ' + m.name + ' (verified on: ' + where + ')';
  if (!force) throw new Error(message + '. Pass --force only if you accept the risk.');
  console.warn('WARNING: ' + message + '. Proceeding because --force was passed.');
}

function sshArgs(opts, command) {
  return ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
    '-p', String(opts.port), '-i', opts.key, 'root@' + opts.host, command];
}

function ssh(opts, command, input) {
  if (opts.dryRun) {
    console.log('[dry-run] ssh ' + opts.host + ' ' + command.split('\n')[0]);
    return '';
  }
  const result = cp.spawnSync('ssh', sshArgs(opts, command), {
    input: input == null ? undefined : input,
    encoding: input == null ? 'utf8' : 'buffer',
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error('ssh failed (' + result.status + '): ' +
      String(result.stderr || '').trim().split('\n').slice(-2).join(' '));
  }
  return input == null ? String(result.stdout) : result.stdout;
}

// opts.ssh and opts.sleep stand in for the SSH lane and the switch poll wait in
// the tests only (the fake emulates the TV's trimmed busybox); every remote
// call in this file goes through them when set.
const sshFn = opts => opts.ssh || ssh;

function upload(opts, local, remote) {
  if (opts.dryRun) {
    console.log('[dry-run] upload ' + local + ' -> ' + remote);
    return;
  }
  sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/local/bin; cat > ' + remote, fs.readFileSync(local));
}

function bootstrap(opts, m) {
  console.log('bootstrap ' + m.name);
  const localStock = path.join(REPO, m.local_stock);
  fs.mkdirSync(path.dirname(localStock), { recursive: true });
  const stock = sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; cat ' + m.app);
  if (!opts.dryRun) {
    fs.writeFileSync(localStock, stock, { mode: 0o600 });
    const md5 = cp.execFileSync('md5sum', [localStock], { encoding: 'utf8' }).split(/\s/)[0];
    assert.equal(md5, m.stock_md5, 'pulled stock md5 does not match the model profile');
    assert.equal(hash(fs.readFileSync(localStock)), m.stock_sha256,
      'pulled stock sha256 does not match the model profile');
    console.log('  stock verified: ' + md5);
  }
  sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; mkdir -p ' + m.state + '/backup; chmod 700 ' + m.state);
  upload(opts, path.join(HERE, m.switch), m.state + '/switch-home.sh');
  upload(opts, localStock, m.state + '/backup/app.js.stock');
  sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; chmod 700 ' + m.state + '/switch-home.sh; ' +
    'chmod 600 ' + m.state + '/backup/app.js.stock');
  console.log('  switch script and stock backup installed');
}

function currentMd5(opts, m) {
  const out = sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; md5sum ' + m.app);
  return String(out).split(/\s/)[0];
}

function runSwitch(opts, m, mode) {
  const done = m.state + '/switch.done';
  const log = m.state + '/switch.log';
  sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; rm -f ' + done + ' ' + log + '; ' +
    '/bin/sh -c \'trap "" HUP; exec /bin/sh ' + m.state + '/switch-home.sh ' + mode + '\' ' +
    '>/dev/null 2>&1 </dev/null & echo started');
  if (opts.dryRun) return;
  const sleep = opts.sleep || (() => cp.execFileSync('sleep', ['2']));
  for (let i = 0; i < 45; i++) {
    sleep();
    let text = '';
    try {
      text = sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; cat ' + done + ' 2>/dev/null');
    } catch (_) { /* not there yet */ }
    if (String(text).trim()) {
      const logText = sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; cat ' + log + ' 2>/dev/null');
      console.log(String(logText).trim());
      if (!/^OK /.test(String(text).trim())) throw new Error('switch failed: ' + String(text).trim());
      return;
    }
  }
  throw new Error('switch did not finish in 90s; SSH is still up, check ' + log);
}

// --- the installer owns the bridge watcher ----------------------------------
//
// A native Home and the bridge watcher are exclusive: with the watcher on, the
// bridge bounces the TV to the canvas page the moment the VIDAA home appears,
// and a perfectly good native install looks like it silently failed. So the
// picker enforces the two coherent setups — install/switch disable the
// watcher, rollback restores whatever the config was before the first native
// install. The decision is pure (applyWatcherConfig); syncWatcher is the only
// part that touches the SSH lane. The JSON work happens on the host (the TV's
// busybox has no jq), and every write lands through a temp file + mv, never a
// truncating redirect on the live file.
const WATCHER_BACKUP = CONFIG + '.bak-native-home';
const WATCHER_TMP = CONFIG + '.tmp-native-home';

// Pure: given config text and a mode, return the text to write, or refuse.
//   disable — text is the live config; the result is the same config with
//             watcher.enabled = false and every other key untouched.
//   restore — text is the backup about to take the live file's place; it is
//             validated and returned byte-for-byte.
// A refusal (invalid JSON, no watcher object) throws and produces no text, so
// the caller cannot write a file it does not understand.
function applyWatcherConfig(text, mode) {
  let config;
  try { config = JSON.parse(text); }
  catch (error) { throw new Error('refusing: config is not valid JSON (' + error.message + '); nothing written'); }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      !config.watcher || typeof config.watcher !== 'object' || Array.isArray(config.watcher)) {
    throw new Error('refusing: config has no usable "watcher" object; nothing written');
  }
  if (mode === 'disable') {
    config.watcher = Object.assign({}, config.watcher, { enabled: false });
    return JSON.stringify(config, null, 2);
  }
  if (mode === 'restore') return String(text);
  throw new Error('unknown watcher mode: ' + mode);
}

// Pure: what status should say about the watcher. Never throws; anything it
// cannot read or understand is "unknown", not a guess.
function watcherState(text) {
  try {
    const config = JSON.parse(text);
    if (config && typeof config === 'object' && !Array.isArray(config) &&
        config.watcher && typeof config.watcher === 'object' && !Array.isArray(config.watcher)) {
      if (config.watcher.enabled === true) return 'on';
      if (config.watcher.enabled === false) return 'off';
    }
  } catch (_) { /* unreadable config */ }
  return 'unknown';
}

// Read and write the watcher config over the SSH lane. mode is "disable" or
// "restore". The backup is copied by the TV itself (cp -p), so it holds the
// original bytes, and only ever if it does not already exist: a second install
// must never replace the original, or rollback restores the wrong thing.
function syncWatcher(opts, m, mode) {
  const P = 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; ';
  const exists = file =>
    String(sshFn(opts)(opts, P + 'test -f ' + file + ' && echo yes || echo no')).trim() === 'yes';
  const read = file => String(sshFn(opts)(opts, P + 'cat ' + file));
  // Replace `file` with `text` atomically: the temp inherits the live file's
  // owner and mode (cp -p), is overwritten, then mv'd into place. A crash
  // leaves the live file intact and a stale temp that the next run replaces.
  const stage = (file, text) => {
    sshFn(opts)(opts, P + 'cp -p ' + file + ' ' + WATCHER_TMP);
    sshFn(opts)(opts, P + 'cat > ' + WATCHER_TMP, Buffer.from(text));
    sshFn(opts)(opts, P + 'mv -f ' + WATCHER_TMP + ' ' + file);
  };
  if (mode === 'disable') {
    if (!exists(CONFIG)) {
      throw new Error('refusing: no bridge config at ' + CONFIG +
        ' — is the bridge deployed on this TV? nothing written');
    }
    const after = applyWatcherConfig(read(CONFIG), 'disable'); // refuses before anything is backed up or written
    sshFn(opts)(opts, P + 'test -f ' + WATCHER_BACKUP + ' || cp -p ' + CONFIG + ' ' + WATCHER_BACKUP);
    stage(CONFIG, after);
    console.log('watcher: disabled in ' + CONFIG + ' (original preserved at ' + WATCHER_BACKUP + ')');
    return;
  }
  if (mode === 'restore') {
    if (!exists(WATCHER_BACKUP)) {
      console.warn('WARNING: no watcher backup at ' + WATCHER_BACKUP +
        ': the watcher state is unknown, and ' + CONFIG + ' was left untouched.');
      return;
    }
    const original = applyWatcherConfig(read(WATCHER_BACKUP), 'restore'); // refuses to clobber with an unreadable backup
    if (exists(CONFIG)) {
      stage(CONFIG, original);
    } else {
      sshFn(opts)(opts, P + 'cat > ' + WATCHER_TMP, Buffer.from(original));
      sshFn(opts)(opts, P + 'chmod 600 ' + WATCHER_TMP);
      sshFn(opts)(opts, P + 'mv -f ' + WATCHER_TMP + ' ' + CONFIG);
    }
    console.log('watcher: restored ' + CONFIG + ' byte-for-byte from ' + WATCHER_BACKUP +
      ' (backup kept, so a repeat rollback stays harmless)');
    return;
  }
  throw new Error('unknown watcher mode: ' + mode);
}

// The post-switch watcher step, shared by install and rollback. Never runs
// silently: either it acts, or it says exactly why it did not — and when a
// sync fails after the bundle swapped, it says exactly what state the TV is in.
function watcherStep(opts, m, mode, what) {
  if (opts.noWatcher) {
    console.warn('WARNING: --no-watcher: the bridge watcher was left untouched. ' +
      (mode === 'disable'
        ? 'With the watcher on, the bridge will hide this native Home within about a second; ' +
          'pass --no-watcher only if the canvas launcher is what you actually want.'
        : 'The stock Home is back, but the watcher state is whatever it was before the native install.'));
    return;
  }
  if (opts.dryRun) {
    console.log('[dry-run] watcher: would ' + (mode === 'disable' ? 'disable' : 'restore') + ' ' + CONFIG +
      (mode === 'disable' ? ' (first run also preserves it at ' + WATCHER_BACKUP + ')'
        : ' from ' + WATCHER_BACKUP + ', if that backup exists'));
    return;
  }
  try {
    syncWatcher(opts, m, mode);
  } catch (error) {
    throw new Error(mode === 'disable'
      ? 'the ' + what + ' bundle IS installed (the switch reported OK), but the watcher sync failed:\n' +
        '  ' + error.message + '\n' +
        'TV state: ' + what + ' bundle in place, watcher config untouched; the bridge will hide the native Home.\n' +
        'Re-run the same install command to retry the watcher sync, or run rollback to get back to stock.'
      : 'the stock Home IS restored (the switch reported OK), but the watcher restore failed:\n' +
        '  ' + error.message + '\n' +
        'TV state: stock Home in place, watcher config untouched; its state is unknown.\n' +
        'Re-run the same rollback command to retry the watcher restore.');
  }
}

function install(id, opts) {
  const v = variant(id);
  const m = model(opts.model);
  checkPair(v, m, opts.force);

  // opts.builder stands in for the variant's real build module in the tests
  // only; a real run requires it, and a real build verifies the pinned stock
  // sha256 before anything is uploaded.
  const builder = opts.builder || require(path.join(HERE, v.build));
  const localStock = path.join(REPO, m.local_stock);
  assert.ok(fs.existsSync(localStock),
    'no pinned stock bundle at ' + m.local_stock + '; run bootstrap first');
  const out = path.join(REPO, 'firmware', opts.model, 'candidate-' + v.id + '.js');
  const candidate = builder.build(localStock, out, m.stock_sha256);
  console.log('built ' + v.name + ': ' + Buffer.byteLength(candidate) + ' bytes, sha256 ' + hash(candidate));

  if (!opts.dryRun) {
    const probe = sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; test -f ' + m.state + '/switch-home.sh && echo yes || echo no');
    if (String(probe).trim() !== 'yes') bootstrap(opts, m);
  }

  upload(opts, out, m.state + '/candidate-native-home.js');
  const md5 = opts.dryRun ? '<dry-run>' :
    cp.execFileSync('md5sum', [out], { encoding: 'utf8' }).split(/\s/)[0];
  sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; printf "%s\\n" "' + md5 + '" > ' +
    m.state + '/candidate.md5; chmod 600 ' + m.state + '/candidate-native-home.js');

  // install when the bundle is stock, switch when another variant is in place.
  const mode = opts.dryRun ? 'install' : (currentMd5(opts, m) === m.stock_md5 ? 'install' : 'switch');
  console.log('mode: ' + mode);
  runSwitch(opts, m, mode);
  if (!opts.dryRun) console.log(v.name + ' is installed on ' + m.name);
  watcherStep(opts, m, 'disable', v.name);
}

function rollback(opts) {
  const m = model(opts.model);
  runSwitch(opts, m, 'rollback');
  console.log('stock restored on ' + m.name);
  watcherStep(opts, m, 'restore', 'stock');
}

// Read-only: what the live config says about the watcher. Anything missing or
// unreadable is "unknown".
function watcherStatus(opts, m) {
  const P = 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; ';
  if (String(sshFn(opts)(opts, P + 'test -f ' + CONFIG + ' && echo yes || echo no')).trim() !== 'yes') {
    return 'unknown';
  }
  return watcherState(String(sshFn(opts)(opts, P + 'cat ' + CONFIG)));
}

function status(opts) {
  const m = model(opts.model);
  const out = sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; /bin/sh ' + m.state + '/switch-home.sh status');
  console.log(String(out).trim());
  if (opts.noWatcher) {
    console.log('watcher: skipped (--no-watcher)');
    return;
  }
  console.log('watcher: ' + watcherStatus(opts, m));
}

function list() {
  console.log('variants');
  for (const v of VARIANTS.variants) {
    console.log('  ' + v.id.padEnd(24) + v.name + '  (' + v.author + ')');
    console.log('    ' + v.summary);
    console.log('    verified: ' + ((v.verified || []).map(e => e.model + ' / ' + e.firmware).join(', ') || 'nowhere yet'));
  }
  console.log('\nmodels');
  for (const [id, m] of Object.entries(MODELS.models)) {
    console.log('  ' + id.padEnd(12) + m.name + '  engine ' + m.engine);
  }
  console.log('\ninstall: node tools/launcher-host/native-install.cjs install <variant> --model <id> --host <tv-ip>');
}

function parse(argv) {
  const args = argv.slice(2);
  const command = args.shift();
  const positional = [];
  const opts = { port: 2222, key: path.join(REPO, 'server/keys/tv_root_ed25519'), dryRun: false, force: false, noWatcher: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--model') opts.model = args[++i];
    else if (arg === '--host') opts.host = args[++i];
    else if (arg === '--key') opts.key = args[++i];
    else if (arg === '--port') opts.port = Number(args[++i]);
    else if (arg === '--force') opts.force = true;
    else if (arg === '--no-watcher') opts.noWatcher = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else positional.push(arg);
  }
  return { command, positional, opts };
}

function main(argv) {
  const { command, positional, opts } = parse(argv);
  if (command === 'list' || !command) return list();
  if (command === 'install') {
    assert.ok(positional[0], 'usage: install <variant> --model <id> --host <ip>');
    assert.ok(opts.model && opts.host, '--model and --host are required');
    return install(positional[0], opts);
  }
  if (command === 'rollback') {
    assert.ok(opts.model && opts.host, '--model and --host are required');
    return rollback(opts);
  }
  if (command === 'status') {
    assert.ok(opts.model && opts.host, '--model and --host are required');
    return status(opts);
  }
  if (command === 'bootstrap') {
    assert.ok(opts.model && opts.host, '--model and --host are required');
    return bootstrap(opts, model(opts.model));
  }
  throw new Error('unknown command: ' + command);
}

if (require.main === module) {
  try { main(process.argv); }
  catch (error) { console.error('error: ' + error.message); process.exit(1); }
}

module.exports = { VARIANTS, MODELS, variant, model, verified, checkPair, parse, main, install, rollback, status, bootstrap,
  applyWatcherConfig, watcherState, watcherStatus, syncWatcher, WATCHER_BACKUP };
