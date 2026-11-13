'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const preview = require('./preview-native-home.cjs');

/* Walk a rendered snapshot flat, the way the component's own tests do. */
function flatten(tree) {
  const out = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    out.push(node);
    for (const child of node.children || []) walk(child);
  }(tree));
  return out;
}

function load() {
  const f = preview.loadFixtureComponent();
  return Object.assign(f, { snap: () => preview.renderSnapshot(f.component, f.instance), flat: () => flatten(preview.renderSnapshot(f.component, f.instance)) });
}

/* ---- the fixture ----------------------------------------------------------- */

test('the fixture loads the component exactly like the tests do', () => {
  const f = load();
  const v = f.instance;
  assert.equal(f.calls.filter(c => c[0] === 'start').length, 1);
  // 39 fixture apps; the component filters browser home, stock home and the
  // blank name, so 36 reach the dock and the overlay.
  assert.equal(v.apps.length, 36);
  const dropped = ['vidaa-home', '206', '301'];
  for (const id of dropped) {
    assert.ok(!v.apps.some(a => a.appId === id), 'filtered: ' + id);
  }
  assert.equal(v.sources.length, 6);
  assert.equal(f.root.AlvidaaNativeActive, v);
  assert.equal(f.bodyListeners.size, 1, 'the component registered its own key listener');
  v.stop();
});

test('fixture inputs carry mixed signal state and the living-room names', () => {
  const f = load();
  const v = f.instance;
  const names = v.sources.map(s => v.sourceName(s));
  assert.deepEqual(names, ['TV', 'PlayStation 5', 'Fire TV Stick', 'Nintendo Switch', 'Steam Machine', 'HDMI6']);
  assert.equal(v.smartIndex(), 0, 'the TV tuner has signal, so smart focus lands there');
  // The same fields the component reads: a live input reports signal on
  // is_signal or has_signal; three of the six are dark, like the real room.
  const dark = v.sources.filter(s => String(s.is_signal) !== '1' && String(s.has_signal) !== '1');
  assert.deepEqual(dark.map(s => s.name), ['HDMI2', 'HDMI5', 'HDMI6']);
  v.stop();
});

test('fixture apps cover the icon shapes the dock actually shows', () => {
  const withIcon = preview.fixtureApps().filter(a => a.img);
  const bare = preview.fixtureApps().filter(a => !a.img);
  assert.ok(withIcon.length >= 5, 'icon apps: generated PNG tiles, allowlist-clean');
  assert.ok(bare.length >= 25, 'bare apps: letter badges with brand colours');
  for (const app of withIcon) {
    assert.match(app.img, /^data:image\/png;base64,/, app.appName + ': PNG, not SVG — the app-icon allowlist refuses svg+xml');
  }
});

/* ---- the h -> DOM-shaped-object conversion --------------------------------- */

test('renderSnapshot converts the tree into DOM-shaped objects', () => {
  const f = load();
  const snap = f.snap();
  assert.equal(snap.tag, 'div');
  assert.equal(snap.attributes.id, 'alvidaa-native');
  assert.equal(snap.style.backgroundColor, '#07080c');
  assert.ok(snap.children.length >= 4, 'dock, apps row, HUD layers');
  const flat = f.flat();
  assert.ok(flat.some(n => n.text === 'APPS'), 'text children become text specs');
  assert.ok(flat.some(n => typeof n.onClick === 'function'), 'on.click survives as onClick');
  const img = flat.find(n => n.tag === 'img');
  assert.ok(img, 'the favorite with an allowlisted icon renders an <img> spec');
  assert.match(img.attributes.src, /^data:image\/png;base64,/);
  assert.equal(img.attributes.alt, 'Netflix');
  const px = flat.find(n => typeof (n.style || {}).fontSize === 'string' && /px$/.test(n.style.fontSize));
  assert.ok(px, 'numeric style values resolve to px strings');
  const unitless = flat.find(n => typeof (n.style || {}).opacity === 'number');
  assert.ok(unitless !== undefined, 'opacity stays unitless like Vue renders it');
  f.instance.stop();
});

test('device shapes are divs, not images (findings 13 section 8)', () => {
  const f = load();
  const flat = f.flat();
  const shapes = flat.filter(n => (n.style || {}).border && /solid/.test(n.style.border) &&
    (n.style || {}).position === 'absolute');
  assert.ok(shapes.length > 10, 'the dock device icons are border/background divs');
  assert.equal(flat.filter(n => n.tag === 'svg').length, 0, 'no SVG elements anywhere');
  f.instance.stop();
});

/* ---- the fixture drives the dock and the overlay --------------------------- */

test('arrows move dock focus through the component handleKey', () => {
  const f = load();
  const v = f.instance;
  assert.equal(v.zone, 'dock');
  assert.equal(flat_focus(f), 1, 'one focused tile');
  v.handleKey(preview.KEYS.RIGHT);
  assert.equal(v.dock, 1);
  assert.equal(flat_focus(f), 1, 'exactly one focused tile after the move');
  const tree = f.snap();
  const flat = flatten(tree);
  const stage = flat.find(n => (n.style || {}).transform);
  assert.match(stage.style.transform, /translateY\(0px\)/, 'dock zone holds the stage at view 1');
  v.handleKey(preview.KEYS.LEFT);
  assert.equal(v.dock, 0);
  v.instance && v.stop();
});

function flat_focus(f) {
  return flatten(f.snap()).filter(n => (n.style || {}).transform === 'scale(1.03)').length;
}

test('ENTER on the Apps tile opens the overlay and BACKSPACE closes it', () => {
  const f = load();
  const v = f.instance;
  v.handleKey(preview.KEYS.DOWN);
  assert.equal(v.zone, 'apps');
  // The row starts on the favorites (the fixture has three); walk to the
  // Apps tile the way the remote would.
  const appsTile = v.appItems().findIndex(i => i.kind === 'apps');
  assert.ok(appsTile > 0, 'favorites sit before the Apps tile in this fixture');
  for (let i = 0; i < appsTile; i++) v.handleKey(preview.KEYS.RIGHT);
  assert.equal(v.app, appsTile);
  const before = flatten(f.snap());
  const stage = before.find(n => (n.style || {}).transform);
  assert.match(stage.style.transform, /translateY\(-/, 'the stage slides to view 2');
  v.handleKey(preview.KEYS.ENTER);
  assert.equal(v.overlay, true);
  const open = flatten(f.snap());
  assert.ok(open.some(n => n.text === 'OK to open \u00b7 BACK to close'), 'the overlay panel is in the tree');
  assert.ok(open.some(n => n.text === 'Netflix'), 'fixture app names fill the grid');
  v.handleKey(preview.KEYS.BACK);
  assert.equal(v.overlay, false);
  assert.ok(!flatten(f.snap()).some(n => n.text === 'OK to open \u00b7 BACK to close'), 'overlay gone from the tree');
  v.stop();
});

test('a favorite tile launches through the platform on ENTER', () => {
  const f = load();
  const v = f.instance;
  v.handleKey(preview.KEYS.DOWN);
  assert.equal(v.zone, 'apps');
  assert.equal(v.appItems()[0].kind, 'favorite');
  assert.equal(v.appItems()[0].label, 'Netflix');
  v.handleKey(preview.KEYS.ENTER);
  assert.deepEqual(f.calls.at(-1), ['launch', '1'], 'the favorite launches its app');
  v.stop();
});

test('arrow keys page the overlay and ENTER launches from it', () => {
  const f = load();
  const v = f.instance;
  v.zone = 'apps';
  v.app = v.appItems().findIndex(i => i.kind === 'apps');
  v.handleKey(preview.KEYS.ENTER);
  assert.equal(v.overlay, true);
  assert.equal(v.overlayIndex, 0);
  v.handleKey(preview.KEYS.RIGHT);
  assert.equal(v.overlayIndex, 1);
  const focused = String(v.apps[v.overlayIndex].appId);
  v.handleKey(preview.KEYS.ENTER);
  // Read before the launch re-sorts apps by recency (issue #55) — the launch
  // goes to the app the overlay focused, whatever index it lands on after.
  assert.deepEqual(f.calls.at(-1), ['launch', focused], 'launch goes through the platform stub');
  v.handleKey(preview.KEYS.BACK);
  assert.equal(v.overlay, false);
  v.stop();
});

/* ---- the page: --out and the served HTML ----------------------------------- */

test('--out writes one self-contained file with the banner and the fixture', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-native-home-'));
  const file = path.join(dir, 'preview.html');
  try {
    const code = preview.main(['node', 'preview-native-home.cjs', '--out', file]);
    assert.equal(code, preview.EXIT.OK);
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /<!doctype html>/);
    assert.ok(html.includes(preview.BANNER), 'the banner is in the file');
    assert.ok(html.includes('PlayStation 5') && html.includes('Nintendo Switch'), 'fixture device names');
    assert.ok(html.includes('AlvidaaNativeHome(sdk)'), 'the real component source is embedded');
    assert.ok(html.includes('data:image/svg+xml;base64,'), 'the real baked device-art rules are embedded');
    assert.ok(html.includes('iVBORw0KGgo'), 'the generated wallpaper is embedded');
    assert.ok(html.includes('function elementFrom('), 'the h→element converter is embedded for the live redraw');
    // The server-side snapshot is real markup, so the page renders even with JS off.
    assert.match(html, /<div id="alvidaa-native" style="position: absolute;/);
    assert.ok(html.includes('border: 3px solid'), 'rendered device-shape borders are in the static markup');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the served page answers with the same HTML, then closes', async () => {
  const server = preview.startServer(0, preview.buildPage());
  await new Promise(resolve => server.on('listening', resolve));
  const port = server.address().port;
  const res = await fetch('http://127.0.0.1:' + port + '/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  const body = await res.text();
  assert.ok(body.includes(preview.BANNER));
  assert.ok(body.includes('AlvidaaNativeHome(sdk)'));
  await new Promise(resolve => server.close(resolve));
});

test('the embedded boot script and component source parse as JS (no browser needed)', () => {
  // The page's live path — component source plus the boot script with the
  // toString()-embedded converter — is exactly the code no node:test can
  // execute without a browser. Parsing it catches template breakage (a bad
  // toString embedding, an unescaped </script>) before the owner opens it.
  const vm = require('node:vm');
  const html = preview.buildPage();
  const scripts = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map(m => m[1]);
  assert.equal(scripts.length, 2, 'component source, then the boot script');
  for (const [which, body] of scripts.entries()) {
    assert.doesNotThrow(() => new vm.Script(body, { filename: 'page-script-' + which + '.js' }),
      'script ' + which + ' must parse');
  }
  assert.match(scripts[1], /component\.render\.call\(v, h\)/, 'the boot script renders through the component');
  // The component listens for the vendor's custom "key-down" event
  // (native-alvidaa.js mounted), which real keypresses never fire — they are
  // "keydown". The boot script must therefore BRIDGE: keydown → handleKey →
  // draw, or the served page's keyboard is a no-op (caught on the first real
  // browser pass: a redraw-only listener passed every node:test).
  assert.match(scripts[0], /addEventListener\("key-down"/, 'the component registers its vendor key event');
  assert.match(scripts[1], /addEventListener\("keydown"[\s\S]*?v\.handleKey\(e\.keyCode\)/,
    'the boot script bridges real keydown to handleKey');
  assert.match(scripts[1], /v\.handleKey\(e\.keyCode\);[\s\S]*?draw\(\);[\s\S]*?preventDefault/,
    'handled keys redraw then preventDefault');
});

test('usage: unknown flags and bad ports are usage errors; --help is clean', () => {
  assert.throws(() => preview.main(['node', 'preview-native-home.cjs', '--nope']), preview.UsageError);
  assert.throws(() => preview.main(['node', 'preview-native-home.cjs', '--port', 'abc']), /--port/);
  assert.throws(() => preview.main(['node', 'preview-native-home.cjs', '--port']), /--port/);
  const logs = [];
  const original = console.log;
  console.log = l => logs.push(String(l));
  let code;
  try { code = preview.main(['node', 'preview-native-home.cjs', '--help']); }
  finally { console.log = original; }
  assert.equal(code, preview.EXIT.OK);
  assert.match(logs[0], /^usage:/);
});
