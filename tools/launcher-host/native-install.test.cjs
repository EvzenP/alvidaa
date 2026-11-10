'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hash, CONFIG } = require('./native-trial.cjs');
const { VARIANTS, MODELS, variant, model, verified, checkPair, parse,
  install, rollback, status, syncWatcher,
  applyWatcherConfig, watcherState, WATCHER_BACKUP } = require('./native-install.cjs');

const HERE = __dirname;
const REPO = path.resolve(HERE, '../..');

test('every variant names real parts, a real builder, and one effective component', () => {
  for (const v of VARIANTS.variants) {
    assert.ok(fs.existsSync(path.join(HERE, v.build)), v.id + ': missing build script');
    const builder = require(path.join(HERE, v.build));
    assert.equal(typeof builder.build, 'function', v.id + ': build is not exported');
    assert.deepEqual(builder.PARTS, v.parts, v.id + ': manifest parts drifted from the builder');
    for (const part of v.parts) {
      assert.ok(fs.existsSync(path.join(HERE, part)), v.id + ': missing part ' + part);
    }
    assert.equal(v.parts[v.parts.length - 1], 'native-entry.js',
      v.id + ': the entry must be appended last');
    const components = v.parts.filter(p => !/^native-platform/.test(p) && p !== 'native-entry.js');
    assert.ok(components.length >= 1, v.id + ': no component part');
    const effective = components[components.length - 1];
    const source = fs.readFileSync(path.join(HERE, effective), 'utf8');
    assert.match(source, /root\.Alvidaa[A-Za-z]+ =/, v.id + ': ' + effective + ' exports no global');
    assert.ok(v.summary && v.author && v.name, v.id + ': incomplete metadata');
  }
});

test('every model profile points at a real switch script and a private stock path', () => {
  for (const [id, m] of Object.entries(MODELS.models)) {
    assert.ok(fs.existsSync(path.join(HERE, m.switch)), id + ': missing switch script');
    assert.match(m.stock_md5, /^[0-9a-f]{32}$/, id + ': bad md5');
    assert.match(m.stock_sha256, /^[0-9a-f]{64}$/, id + ': bad sha256');
    assert.ok(m.local_stock.startsWith('firmware/'), id + ': stock copy must stay private');
    assert.ok(m.app.startsWith('/APPS/'), id + ': app path must be the writable module');
    assert.ok(m.state.startsWith('/var/local/'), id + ': state must live on /var/local');
    assert.equal(typeof m.engine, 'string');
  }
});

test('verification is per model, not per variant', () => {
  const fmtv = variant('free-my-tv');
  assert.equal(verified(fmtv, model('50a51huv')), true);
  assert.equal(verified(fmtv, model('75u8qtuk')), false);
  const ours = variant('alvidaa');
  assert.equal(verified(ours, model('50a51huv')), true);
  assert.equal(verified(ours, model('75u8qtuk')), false);
  const port = variant('free-my-tv-75u8qtuk');
  assert.equal(verified(port, model('75u8qtuk')), true);
  assert.equal(verified(port, model('50a51huv')), false);
});

test('an unverified pairing is refused unless forced, and says why', () => {
  const port = variant('free-my-tv-75u8qtuk');
  const reference = model('50a51huv');
  assert.throws(() => checkPair(port, reference, false), /has not been verified on 50A51HUV/);
  const warnings = [];
  const original = console.warn;
  console.warn = message => warnings.push(message);
  try { checkPair(port, reference, true); } finally { console.warn = original; }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /--force/);
  assert.doesNotThrow(() => checkPair(variant('alvidaa'), reference, false));
});

test('each builder assembles its variant against a pinned stock and parses', () => {
  const dir = fs.mkdtempSync('/tmp/alvidaa-variants-');
  const stockFile = path.join(dir, 'stock.js');
  const stock = '/* private vendor bundle */\nself._V_M_={launcher:function(){return {route:[{path:"/Launcher",component:{}}]}}};\n';
  fs.writeFileSync(stockFile, stock);
  const digest = hash(Buffer.from(stock));
  for (const v of VARIANTS.variants) {
    const builder = require(path.join(HERE, v.build));
    const out = path.join(dir, v.id + '.js');
    const candidate = builder.build(stockFile, out, digest);
    assert.ok(candidate.includes(stock), v.id + ': stock bundle missing');
    for (const part of v.parts) {
      assert.ok(candidate.includes(fs.readFileSync(path.join(HERE, part), 'utf8')),
        v.id + ': ' + part + ' missing from the candidate');
    }
    assert.doesNotThrow(() => new vm.Script(candidate), v.id + ': candidate does not parse');
    assert.ok(fs.existsSync(out), v.id + ': output not written');
    assert.throws(() => builder.build(stockFile, path.join(HERE, 'x.js'), digest),
      /must stay private/, v.id + ': private-output guard missing');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the command line parses flags and rejects unknown variants and models', () => {
  const parsed = parse(['node', 'x', 'install', 'alvidaa', '--model', '50a51huv',
    '--host', '192.0.2.10', '--port', '2222', '--force', '--dry-run']);
  assert.equal(parsed.command, 'install');
  assert.deepEqual(parsed.positional, ['alvidaa']);
  assert.equal(parsed.opts.model, '50a51huv');
  assert.equal(parsed.opts.host, '192.0.2.10');
  assert.equal(parsed.opts.force, true);
  assert.equal(parsed.opts.dryRun, true);
  assert.throws(() => variant('nope'), /unknown variant/);
  assert.throws(() => model('nope'), /unknown model/);
});

// --- the installer owns the bridge watcher ----------------------------------
//
// The decision (applyWatcherConfig) is tested directly. The wiring is tested
// through a fake TV: a Map of absolute paths plus a tiny busybox that
// understands only the commands native-install.cjs actually issues. Anything
// else throws, so a new remote command has to be taught to the fake before it
// can be tested — the fake cannot silently pass a command the real TV would
// choke on.

const WATCHER_TMP = CONFIG + '.tmp-native-home';
const M = MODELS.models['50a51huv'];
const APP = M.app;
const STATE = M.state;
const ORIGINAL = JSON.stringify({
  logLevel: 'info',
  watcher: { enabled: true, app: 'Home', intervalSec: 5 },
  untouched: { deep: [1, 2, 3] }
});

function fakeTV(t, initial) {
  const files = new Map();
  const md5 = new Map(); // path -> md5 the TV should report (what is installed)
  for (const [p, text] of Object.entries(initial)) files.set(p, Buffer.from(text));
  const fail = body => { throw new Error('ssh failed (1): ' + body); };
  const ssh = (opts, command, input) => {
    const body = command.replace(/^export PATH=[^;]+; /, '');
    let m;
    if ((m = body.match(/^test -f (\S+) && echo yes \|\| echo no$/))) return files.has(m[1]) ? 'yes\n' : 'no\n';
    if ((m = body.match(/^test -f (\S+) \|\| cp -p (\S+) (\S+)$/))) {
      if (!files.has(m[1]) && files.has(m[2])) files.set(m[1], Buffer.from(files.get(m[2])));
      return '';
    }
    if ((m = body.match(/^cat (\S+) 2>\/dev\/null$/))) {
      if (!files.has(m[1])) fail(body);
      return files.get(m[1]).toString();
    }
    if ((m = body.match(/^cat > (\S+)$/))) { files.set(m[1], Buffer.from(input)); return ''; }
    if ((m = body.match(/^cat (\S+)$/))) {
      if (!files.has(m[1])) fail(body);
      return files.get(m[1]).toString();
    }
    if ((m = body.match(/^cp -p (\S+) (\S+)$/))) {
      if (!files.has(m[1])) fail(body);
      files.set(m[2], Buffer.from(files.get(m[1])));
      return '';
    }
    if ((m = body.match(/^mv -f (\S+) (\S+)$/))) {
      if (!files.has(m[1])) fail(body);
      files.set(m[2], files.get(m[1]));
      files.delete(m[1]);
      return '';
    }
    if ((m = body.match(/^chmod [0-7]+ (\S+)$/))) return '';
    if ((m = body.match(/^md5sum (\S+)$/))) {
      if (!md5.has(m[1])) fail(body);
      return md5.get(m[1]) + '  ' + m[1] + '\n';
    }
    if ((m = body.match(/^rm -f (\S+) (\S+); \/bin\/sh -c '.+' >\/dev\/null 2>&1 <\/dev\/null & echo started$/))) {
      const mode = (body.match(/switch-home\.sh (\w+)/) || [])[1] || 'unknown';
      // The detached script "finishes": done carries the OK/FAIL verdict.
      files.set(m[1], Buffer.from('OK ' + mode + ' finished\n'));
      files.set(m[2], Buffer.from('switch ' + mode + ': OK\n'));
      return 'started\n';
    }
    if ((m = body.match(/^printf "%s\\n" "([0-9a-f]{32})" > (\S+); chmod 600 (\S+)$/))) {
      files.set(m[2], Buffer.from(m[1] + '\n'));
      return '';
    }
    if ((m = body.match(/^\/bin\/sh (\S+) status$/))) {
      return 'bundle: candidate md5 matches\nengine: ' + M.engine + ' pid 4242\n';
    }
    fail('fake TV: unhandled command: ' + body);
  };
  return { files, md5, ssh };
}

function watcherFixture(t, configText) {
  const tv = fakeTV(t, {
    [CONFIG]: configText === undefined ? ORIGINAL : configText,
    [STATE + '/switch-home.sh']: '#!/bin/sh\n',
    [APP]: 'stock bundle bytes'
  });
  tv.md5.set(APP, M.stock_md5); // the TV currently runs stock
  return tv;
}

test('disable turns the watcher off and leaves every other key untouched', () => {
  const after = JSON.parse(applyWatcherConfig(ORIGINAL, 'disable'));
  assert.equal(after.watcher.enabled, false);
  assert.equal(after.watcher.app, 'Home');
  assert.equal(after.watcher.intervalSec, 5);
  assert.equal(after.logLevel, 'info');
  assert.deepEqual(after.untouched, { deep: [1, 2, 3] });
});

test('disable is idempotent', () => {
  const once = applyWatcherConfig(ORIGINAL, 'disable');
  assert.equal(applyWatcherConfig(once, 'disable'), once);
});

test('restore validates the backup and returns it byte-for-byte', () => {
  const bytes = '{\n  "watcher": { "enabled": true },\n  "odd": " spacing "\n}';
  assert.equal(applyWatcherConfig(bytes, 'restore'), bytes);
  assert.throws(() => applyWatcherConfig('{', 'restore'), /not valid JSON/);
  assert.throws(() => applyWatcherConfig('{"no watcher": true}', 'restore'), /watcher/);
});

test('refusals: unreadable configs and unknown modes never produce output text', () => {
  assert.throws(() => applyWatcherConfig('{', 'disable'), /not valid JSON/);
  assert.throws(() => applyWatcherConfig('[]', 'disable'), /watcher/);
  assert.throws(() => applyWatcherConfig('null', 'disable'), /watcher/);
  assert.throws(() => applyWatcherConfig('{"watcher": 7}', 'disable'), /watcher/);
  assert.throws(() => applyWatcherConfig('{"watcher": null}', 'disable'), /watcher/);
  assert.throws(() => applyWatcherConfig(ORIGINAL, 'enable'), /unknown watcher mode/);
});

test('watcherState reads on, off and unknown, and never throws', () => {
  assert.equal(watcherState(ORIGINAL), 'on');
  assert.equal(watcherState(applyWatcherConfig(ORIGINAL, 'disable')), 'off');
  for (const text of ['{}', '{"watcher": 7}', '{"watcher":{"enabled":"yes"}}', '{', '', '[]']) {
    assert.equal(watcherState(text), 'unknown', text);
  }
});

test('disable writes over ssh atomically and preserves the original exactly once', t => {
  const tv = watcherFixture(t);
  const opts = { ssh: tv.ssh, model: '50a51huv' };
  syncWatcher(opts, M, 'disable');
  const after = JSON.parse(tv.files.get(CONFIG).toString());
  assert.equal(after.watcher.enabled, false);
  assert.deepEqual(after.untouched, { deep: [1, 2, 3] });
  assert.deepEqual(tv.files.get(WATCHER_BACKUP), Buffer.from(ORIGINAL)); // the original bytes
  assert.equal(tv.files.has(WATCHER_TMP), false); // mv left no temp behind
  const once = tv.files.get(CONFIG).toString();
  syncWatcher(opts, M, 'disable'); // a second install is idempotent...
  assert.equal(tv.files.get(CONFIG).toString(), once);
  // ...and even if the config changed again by hand in between, the backup
  // still holds the first original.
  tv.files.set(CONFIG, Buffer.from(JSON.stringify({ watcher: { enabled: true }, touched: 'by hand' })));
  syncWatcher(opts, M, 'disable');
  assert.deepEqual(tv.files.get(WATCHER_BACKUP), Buffer.from(ORIGINAL));
  const back = JSON.parse(tv.files.get(CONFIG).toString());
  assert.equal(back.watcher.enabled, false);
  assert.equal(back.touched, 'by hand');
});

test('restore reproduces the original bytes and keeps the backup', t => {
  const tv = watcherFixture(t);
  const opts = { ssh: tv.ssh, model: '50a51huv' };
  syncWatcher(opts, M, 'disable');
  const original = tv.files.get(WATCHER_BACKUP);
  syncWatcher(opts, M, 'restore');
  assert.deepEqual(tv.files.get(CONFIG), original); // byte-for-byte, not a re-serialization
  assert.deepEqual(tv.files.get(WATCHER_BACKUP), original); // kept for the next rollback
  syncWatcher(opts, M, 'restore'); // a second rollback is a harmless no-op
  assert.deepEqual(tv.files.get(CONFIG), original);
});

test('restore recreates the config if it vanished, still byte-for-byte', t => {
  const tv = watcherFixture(t);
  tv.files.set(WATCHER_BACKUP, Buffer.from(ORIGINAL));
  tv.files.delete(CONFIG);
  syncWatcher({ ssh: tv.ssh, model: '50a51huv' }, M, 'restore');
  assert.deepEqual(tv.files.get(CONFIG), Buffer.from(ORIGINAL));
  assert.equal(tv.files.has(WATCHER_TMP), false);
});

test('restore with no backup warns that the watcher state is unknown and changes nothing', t => {
  const tv = watcherFixture(t); // no install has ever run: no backup
  const warnings = [];
  const original = console.warn;
  console.warn = message => warnings.push(String(message));
  try { syncWatcher({ ssh: tv.ssh, model: '50a51huv' }, M, 'restore'); } finally { console.warn = original; }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /state is unknown/);
  assert.equal(tv.files.get(CONFIG).toString(), ORIGINAL);
});

test('an unreadable config is refused, and nothing on the TV changes', t => {
  const broken = '{ "watcher": { "enabled": true }, oops';
  const tv = watcherFixture(t, broken);
  assert.throws(() => syncWatcher({ ssh: tv.ssh, model: '50a51huv' }, M, 'disable'), /not valid JSON/);
  assert.equal(tv.files.get(CONFIG).toString(), broken);
  assert.equal(tv.files.has(WATCHER_BACKUP), false); // not even a backup of garbage
  assert.equal(tv.files.has(WATCHER_TMP), false);
});

test('a config without a watcher object is refused, and nothing changes', t => {
  for (const text of ['{}', '{"bridge":{"port":8770}}', '[]', '{"watcher": null}']) {
    const tv = watcherFixture(t, text);
    assert.throws(() => syncWatcher({ ssh: tv.ssh, model: '50a51huv' }, M, 'disable'), /watcher/);
    assert.equal(tv.files.get(CONFIG).toString(), text);
    assert.equal(tv.files.has(WATCHER_BACKUP), false);
  }
});

test('a missing config is refused, not created', t => {
  const tv = watcherFixture(t);
  tv.files.delete(CONFIG);
  assert.throws(() => syncWatcher({ ssh: tv.ssh, model: '50a51huv' }, M, 'disable'), /no bridge config/);
  assert.equal(tv.files.has(CONFIG), false);
  assert.equal(tv.files.has(WATCHER_BACKUP), false);
});

test('status reports the watcher: on, off and unknown', t => {
  const logs = [];
  const original = console.log;
  console.log = message => logs.push(String(message));
  try {
    const tv = watcherFixture(t);
    status({ ssh: tv.ssh, model: '50a51huv' });
    assert.ok(logs.includes('watcher: on'), logs.join('\n'));
    tv.files.set(CONFIG, Buffer.from(applyWatcherConfig(ORIGINAL, 'disable')));
    logs.length = 0;
    status({ ssh: tv.ssh, model: '50a51huv' });
    assert.ok(logs.includes('watcher: off'), logs.join('\n'));
    logs.length = 0;
    status({ ssh: tv.ssh, model: '50a51huv', noWatcher: true });
    assert.ok(logs.includes('watcher: skipped (--no-watcher)'), logs.join('\n'));
    logs.length = 0;
    tv.files.set(CONFIG, Buffer.from('not json at all'));
    status({ ssh: tv.ssh, model: '50a51huv' });
    assert.ok(logs.includes('watcher: unknown'), logs.join('\n'));
    tv.files.delete(CONFIG);
    logs.length = 0;
    status({ ssh: tv.ssh, model: '50a51huv' });
    assert.ok(logs.includes('watcher: unknown'), logs.join('\n'));
  } finally { console.log = original; }
});

test('rollback restores stock and hands the watcher back; a repeat is a no-op', t => {
  const logs = [];
  const original = console.log;
  console.log = message => logs.push(String(message));
  try {
    const tv = watcherFixture(t);
    // State after a native install: watcher off, backup holding the pre-native original.
    tv.files.set(WATCHER_BACKUP, Buffer.from(ORIGINAL));
    tv.files.set(CONFIG, Buffer.from(JSON.stringify({ watcher: { enabled: false }, native: 'home was here' })));
    rollback({ ssh: tv.ssh, sleep: () => {}, model: '50a51huv' });
    assert.deepEqual(tv.files.get(CONFIG), Buffer.from(ORIGINAL)); // pre-native bytes back
    assert.ok(tv.files.has(WATCHER_BACKUP)); // still there for the next rollback
    assert.ok(logs.some(l => /watcher: restored/.test(l)), logs.join('\n'));
    rollback({ ssh: tv.ssh, sleep: () => {}, model: '50a51huv' });
    assert.deepEqual(tv.files.get(CONFIG), Buffer.from(ORIGINAL));
  } finally { console.log = original; }
});

test('rollback with --no-watcher leaves the config alone and says so', t => {
  const warnings = [];
  const original = console.warn;
  console.warn = message => warnings.push(String(message));
  try {
    const tv = watcherFixture(t);
    tv.files.set(WATCHER_BACKUP, Buffer.from(ORIGINAL));
    tv.files.set(CONFIG, Buffer.from(JSON.stringify({ watcher: { enabled: false } })));
    rollback({ ssh: tv.ssh, sleep: () => {}, model: '50a51huv', noWatcher: true });
    assert.deepEqual(JSON.parse(tv.files.get(CONFIG).toString()), { watcher: { enabled: false } });
    assert.ok(warnings.some(w => w.includes('--no-watcher') && /watcher state is whatever/.test(w)), warnings.join('\n'));
  } finally { console.warn = original; }
});

// The stock bundle is vendor code and never enters the repo, so the wiring
// test stubs the build and cleans up after itself; the real builders verify
// the pinned sha256 and are covered by their own tests.
function stubBuildForWiring(t) {
  const stock = path.join(REPO, M.local_stock);
  const candidateOut = path.join(REPO, 'firmware', '50a51huv', 'candidate-alvidaa.js');
  const hadStock = fs.existsSync(stock);
  const hadCandidate = fs.existsSync(candidateOut);
  fs.mkdirSync(path.dirname(stock), { recursive: true });
  if (!hadStock) fs.writeFileSync(stock, '/* test stand-in for the pinned stock bundle */\n');
  t.after(() => {
    if (!hadStock) {
      fs.rmSync(stock, { force: true });
      for (let dir = path.dirname(stock); dir !== path.join(REPO, 'firmware'); dir = path.dirname(dir)) {
        try { fs.rmdirSync(dir); } catch (_) { break; }
      }
    }
    if (!hadCandidate) {
      fs.rmSync(candidateOut, { force: true });
      try { fs.rmdirSync(path.dirname(candidateOut)); } catch (_) { /* not empty or gone */ }
    }
  });
  return { build: (stockFile, out) => { fs.writeFileSync(out, '/* wiring-test candidate */\n'); return '/* wiring-test candidate */\n'; } };
}

test('install ends with the watcher disabled and the pre-native config preserved', t => {
  const tv = watcherFixture(t);
  const builder = stubBuildForWiring(t);
  const logs = [];
  const original = console.log;
  console.log = message => logs.push(String(message));
  try {
    install('alvidaa', { ssh: tv.ssh, sleep: () => {}, model: '50a51huv', builder });
  } finally { console.log = original; }
  assert.ok(logs.includes('mode: install'), logs.join('\n'));
  assert.ok(logs.some(l => /watcher: disabled/.test(l)), logs.join('\n'));
  const config = JSON.parse(tv.files.get(CONFIG).toString());
  assert.equal(config.watcher.enabled, false);
  assert.deepEqual(config.untouched, { deep: [1, 2, 3] });
  assert.deepEqual(tv.files.get(WATCHER_BACKUP), Buffer.from(ORIGINAL)); // taken once, on the first install
  assert.ok(tv.files.has(STATE + '/candidate-native-home.js')); // the bundle work happened
});

test('install with --no-watcher swaps the bundle but leaves the config alone, loudly', t => {
  const tv = watcherFixture(t);
  const builder = stubBuildForWiring(t);
  const warnings = [];
  const original = console.warn;
  console.warn = message => warnings.push(String(message));
  try {
    install('alvidaa', { ssh: tv.ssh, sleep: () => {}, model: '50a51huv', builder, noWatcher: true });
  } finally { console.warn = original; }
  assert.equal(tv.files.get(CONFIG).toString(), ORIGINAL); // untouched
  assert.equal(tv.files.has(WATCHER_BACKUP), false);
  assert.ok(tv.files.has(STATE + '/candidate-native-home.js'));
  assert.ok(warnings.some(w => w.includes('--no-watcher') && /hide this native Home/.test(w)), warnings.join('\n'));
});

test('--no-watcher parses as an opt-in skip, off by default', () => {
  const parsed = parse(['node', 'x', 'rollback', '--model', '50a51huv', '--host', '192.0.2.10', '--no-watcher']);
  assert.equal(parsed.opts.noWatcher, true);
  assert.equal(parse(['node', 'x', 'status']).opts.noWatcher, false);
});
