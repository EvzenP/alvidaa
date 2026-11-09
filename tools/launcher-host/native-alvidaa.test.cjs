'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { hash } = require('./native-trial.cjs');

const SOURCE = fs.readFileSync(path.join(__dirname, 'native-alvidaa.js'), 'utf8');
const ENTRY = fs.readFileSync(path.join(__dirname, 'native-entry.js'), 'utf8');
const KEYS = { HOME: 36, LAUNCHER: 547, SOURCE: 515, KEYPAD_INPUT: 516,
  UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39, ENTER: 13, BACK: 8, RETURN: 461 };

function setup() {
  const calls = [], timers = new Map();
  let next = 0;
  const bodyListeners = new Set();
  const root = {
    innerWidth: 1920,
    addEventListener() {}, removeEventListener() {},
    document: { body: {
      addEventListener(_name, fn) { bodyListeners.add(fn); },
      removeEventListener(_name, fn) { bodyListeners.delete(fn); }
    } }
  };
  const sdk = {
    key: { KEYMAP: KEYS },
    storage: { get: () => undefined, set: () => {} },
    apc: { CMDMETHOD: { KEY_INPUT_START: 'input' } },
    router: { isCurrentPathEqualTo: () => true }
  };
  root._V_SDK_ = { vre: { SDK: () => sdk } };
  let notify;
  root.AlvidaaNativePlatform = (_sdk, callback) => {
    notify = callback;
    return {
      start() {
        calls.push(['start']);
        callback({
          apps: [
            { appId: '1', appName: 'Netflix', img: 'var/local/storeAppIcon/netflix.png' },
            { appId: '2', appName: 'Plex', img: 'https://cdn.example/plex.png' },
            { appId: 'vidaa-home', appName: 'Old browser home' },
            { appId: '206', appName: 'Stock Home' },
            { appId: '3', appName: '   ' }
          ],
          sources: [
            { sourceId: 0, name: 'TV', is_signal: '1' },
            { sourceId: 'HDMI2', name: 'HDMI2', displayname2: 'PlayStation 5', is_signal: 0 },
            { sourceId: 'HDMI3', name: 'HDMI3', rename: 'Fire TV Stick', has_signal: '1' }
          ],
          errors: [], waiting: false
        });
      },
      stop() { calls.push(['stop']); },
      refresh() { calls.push(['refresh']); },
      launchApp(id) { calls.push(['launch', String(id)]); },
      changeSource(id) { calls.push(['source', id]); },
      openSettings() { calls.push(['settings']); }
    };
  };
  vm.runInNewContext(SOURCE, {
    self: root,
    setInterval(fn) { const id = ++next; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); }
  });
  const component = root.AlvidaaNativeHome(sdk);
  const instance = component.data();
  instance.$route = { query: {} };
  for (const [key, fn] of Object.entries(component.methods)) instance[key] = fn.bind(instance);
  return { root, sdk, component, instance, calls, timers, notify: () => notify, bodyListeners };
}

function flatten(tree) {
  const out = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    out.push(node);
    for (const child of node.children || []) walk(child);
  }(tree));
  return out;
}

test('starts once, filters apps and inputs, and cleans up', () => {
  const f = setup(), v = f.instance;
  f.component.mounted.call(v);
  f.component.activated.call(v);
  assert.equal(f.calls.filter(c => c[0] === 'start').length, 1);
  assert.equal(v.apps.length, 2);
  assert.deepEqual(v.apps.map(a => a.appId), ['1', '2']);
  assert.equal(v.sources.length, 3);
  assert.match(v.status, /Native · 2 apps · 3 inputs/);
  assert.equal(f.root.AlvidaaNativeActive, v);
  assert.equal(f.bodyListeners.size, 1);
  f.component.deactivated.call(v);
  assert.equal(f.calls.filter(c => c[0] === 'stop').length, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.bodyListeners.size, 0);
  assert.equal(f.root.AlvidaaNativeActive, null);
  f.component.activated.call(v);
  assert.equal(f.calls.filter(c => c[0] === 'start').length, 2);
  v.stop();
});

test('input names follow the bridge order and signal drives smart focus', () => {
  const f = setup(), v = f.instance;
  v.start();
  assert.equal(v.sourceName(v.sources[0]), 'TV');
  assert.equal(v.sourceName(v.sources[1]), 'PlayStation 5');
  assert.equal(v.sourceName(v.sources[2]), 'Fire TV Stick');
  assert.equal(v.smartIndex(), 0);
  v.sources = [{ sourceId: 1, name: 'A' }, { sourceId: 2, name: 'B', is_signal: '1' }];
  assert.equal(v.smartIndex(), 1);
  v.sources = [{ sourceId: 1, name: 'A' }];
  assert.equal(v.smartIndex(), 0);
  f.sdk.i18n = { t: key => key === 'LA0159' ? 'Media' : key };
  assert.equal(v.sourceName({ sourceId: 'x', rename: 'LA0159', name: 'Media' }), 'Media');
  assert.equal(v.sourceName({ sourceId: 'x', rename: 'PlayStation', name: 'HDMI3' }), 'PlayStation');
  v.stop();
});

test('remote walks the dock, the apps row and the stock settings door', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  assert.equal(v.zone, 'dock');
  v.handleKey(k.RIGHT);
  assert.equal(v.dock, 1);
  v.handleKey(k.LEFT);
  v.handleKey(k.LEFT);
  assert.equal(v.dock, 0);
  v.handleKey(k.ENTER);
  assert.deepEqual(f.calls.at(-1), ['source', 0]);
  v.handleKey(k.DOWN);
  assert.equal(v.zone, 'apps');
  v.handleKey(k.ENTER);
  assert.equal(v.overlay, true);
  v.handleKey(k.BACK);
  assert.equal(v.overlay, false);
  v.handleKey(k.RIGHT);
  assert.equal(v.app, 1);
  v.handleKey(k.ENTER);
  assert.deepEqual(f.calls.at(-1), ['settings']);
  v.handleKey(k.BACK);
  assert.equal(v.zone, 'dock');
  assert.equal(v.handleKey(k.BACK), false);
  assert.equal(v.handleKey(k.UP), false);
  assert.equal(v.handleKey(999), false);
  v.stop();
});

test('app overlay pages, launches and clamps at both ends', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  v.apps = Array.from({ length: 12 }, (_, i) => ({ appId: String(i), appName: 'App ' + i }));
  v.zone = 'apps';
  v.app = 0;
  v.handleKey(k.ENTER);
  assert.equal(v.overlay, true);
  v.handleKey(k.RIGHT);
  assert.equal(v.overlayIndex, 1);
  v.handleKey(k.DOWN);
  assert.equal(v.overlayIndex, 7);
  v.handleKey(k.ENTER);
  assert.deepEqual(f.calls.at(-1), ['launch', '7']);
  assert.equal(v.overlay, false);
  v.overlay = true;
  v.overlayIndex = 11;
  v.handleKey(k.RIGHT);
  assert.equal(v.overlayIndex, 11);
  v.overlayIndex = 0;
  v.handleKey(k.UP);
  assert.equal(v.overlayIndex, 0);
  v.overlay = false;
  v.apps = [];
  v.zone = 'apps';
  v.app = 0;
  v.handleKey(k.ENTER);
  assert.equal(v.overlay, false);
  assert.match(v.status, /No apps reported/);
  v.stop();
});

test('failed actions surface in the status line instead of throwing', () => {
  const f = setup(), v = f.instance;
  v.start();
  v._platform.changeSource = () => { throw new Error('input busy'); };
  v.zone = 'dock';
  v.dock = 0;
  v.activate();
  assert.match(v.status, /Action failed: input busy/);
  v._platform.openSettings = () => Promise.reject(new Error('denied'));
  v.zone = 'apps';
  v.app = 1;
  v.activate();
  return Promise.resolve().then(() => {
    assert.match(v.status, /Action failed: denied/);
    v.stop();
  });
});

test('render keeps the dock design, scales it and never loads the open web', () => {
  const f = setup(), v = f.instance;
  v.start();
  v.width = 1280;
  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));
  const tree = draw();
  const flat = flatten(tree);
  const texts = flat.flatMap(n => n.children || []).filter(c => typeof c === 'string');
  assert.ok(texts.includes('INPUTS & SOURCES'));
  assert.ok(texts.includes('APPS'));
  assert.ok(texts.includes('Apps'));
  assert.ok(texts.includes('Settings'));
  assert.ok(texts.includes('TV'));
  assert.ok(texts.includes('connected'));
  assert.equal(flat.filter(n => ['canvas', 'iframe', 'img', 'script'].includes(n.tag)).length, 0);
  const title = flat.find(n => (n.children || []).includes('INPUTS & SOURCES'));
  assert.equal(title.data.style.fontSize, 22 * 1280 / 1920 + 'px');
  // Lengths scale with the viewport; font weights must not.
  assert.equal(title.data.style.lineHeight, 26 * 1280 / 1920 + 'px');
  const clock = flat.find(n => n.data && n.data.style && n.data.style.letterSpacing);
  assert.equal(clock.data.style.fontWeight, '300');
  assert.equal(clock.data.style.lineHeight, 120 * 1280 / 1920 + 'px');
  assert.equal(v.overlay, false);
  assert.doesNotMatch(JSON.stringify(tree), /cdn\.example/);
  // The focused dock tile lifts; the others stay put.
  const scales = flat.filter(n => n.data && n.data.style && n.data.style.transform)
    .map(n => n.data.style.transform);
  assert.ok(scales.includes('scale(1.03)'));
  assert.ok(scales.includes('scale(1)'));
  // A no-signal port keeps the design's grey name and its own subline.
  v.dock = 1;
  const quiet = flatten(draw());
  const quietTexts = quiet.flatMap(n => n.children || []).filter(c => typeof c === 'string');
  assert.ok(quietTexts.includes('PlayStation 5'));
  assert.ok(quietTexts.includes('no signal'));
  v.stop();
});

test('the apps row pans into view and the overlay paints local icons only', () => {
  const f = setup(), v = f.instance;
  v.start();
  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));
  const dockTree = flatten(draw());
  const stage = dockTree.find(n => n.data && n.data.style && n.data.style.transition);
  assert.equal(stage.data.style.transform, 'translateY(0px)');
  assert.equal(stage.data.style.height, '2160px');
  v.zone = 'apps';
  assert.equal(flatten(draw()).find(n => n.data && n.data.style && n.data.style.transition)
    .data.style.transform, 'translateY(-1080px)');
  v.zone = 'dock';
  v.overlay = true;
  v.overlayIndex = 0;
  const overlay = flatten(draw());
  const images = overlay.filter(n => n.data && n.data.style && n.data.style.backgroundImage);
  const urls = images.map(n => n.data.style.backgroundImage).filter(value => value.indexOf('url(') === 0);
  assert.deepEqual(urls, ['url("file:///hisenseUI/var/local/storeAppIcon/netflix.png")']);
  assert.ok(overlay.some(n => (n.children || []).includes('Netflix')));
  assert.ok(overlay.some(n => (n.children || []).includes('OK to open · BACK to close')));
  // Plex has only a remote icon, so it falls back to its brand colour rather
  // than a random hue, and never fetches the remote URL.
  const plexBadge = overlay.find(n => n.data && n.data.style &&
    n.data.style.backgroundColor === '#e5a00d');
  assert.ok(plexBadge, 'Plex badge should use its brand colour');
  v.stop();
});

test('icon policy: local files and the vendor host only', () => {
  const f = setup(), v = f.instance;
  v.start();
  assert.equal(v.appIcon({ img: 'var/local/storeAppIcon/x.png' }), 'file:///hisenseUI/var/local/storeAppIcon/x.png');
  assert.equal(v.appIcon({ img: 'file:///local/x.png' }), 'file:///local/x.png');
  assert.equal(v.appIcon({ img: 'https://img.vidaahub.com/a/b.png' }), 'https://img.vidaahub.com/a/b.png');
  assert.equal(v.appIcon({ img: 'https://cdn.example/x.png' }), '');
  assert.equal(v.appIcon({ img: 'http://img.vidaahub.com/x.png' }), '');
  assert.equal(v.appIcon({ icon_local_url: '/data/x.png' }), '/data/x.png');
  // Some builds wrap the URL in a data:image trampoline.
  assert.equal(v.appIcon({ httpIcon: 'data:image/png;base64,zzziconDownloadhttps://img.vidaahub.com/x.png' }),
    'https://img.vidaahub.com/x.png');
  v.stop();
});

test('the dock pages six at a time and the wallpaper is a build-time global', () => {
  const f = setup(), v = f.instance;
  v.start();
  v.sources = Array.from({ length: 8 }, (_, i) => ({ sourceId: i, name: 'In ' + i }));
  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));
  const flat = flatten(draw());
  const tiles = flat.filter(n => (n.children || []).some(c => c === 'LIVE' || c === 'STANDBY'));
  assert.equal(tiles.length, 6);
  assert.ok(flat.some(n => n.data && n.data.style && n.data.style.backgroundImage &&
    n.data.style.backgroundImage.indexOf('linear-gradient(180deg, rgba(56,189,248') === 0));
  f.root.AlvidaaNativeWallpaper = 'data:image/png;base64,AAA';
  const withArt = flatten(draw()).filter(n => n.data && n.data.style &&
    n.data.style.backgroundImage === 'url("data:image/png;base64,AAA")');
  assert.equal(withArt.length, 1);
  v.stop();
});

test('entry prefers the alvidaa variant, falls back to Free My TV, and only swaps Home', () => {
  function run(globals) {
    const context = Object.assign({
      _V_SDK_: { vre: { SDK: function () { return { key: { KEYMAP: {} } }; } } }
    }, globals);
    context.self = context;
    vm.runInNewContext(ENTRY, context);
    return context;
  }
  const guard = () => {}, kids = () => {}, init = () => {};
  const stock = () => ({
    route: [{ path: '/Launcher', component: { old: true }, beforeEnter: guard },
      { path: '/KidsLauncher', component: kids }],
    page: { kidsLauncherHome: kids }, init
  });
  const mine = function () { return { name: 'Launcher', marker: 'alvidaa' }; };
  const theirs = function () { return { name: 'Launcher', marker: 'free-my-tv' }; };
  const a = run({ _V_M_: { launcher: stock }, AlvidaaNativeComponent: mine, AlvidaaFreeMyTV: theirs });
  const wrapped = a._V_M_.launcher();
  assert.equal(wrapped.route[0].component.marker, 'alvidaa');
  assert.equal(wrapped.route[0].beforeEnter, guard);
  assert.equal(wrapped.route[1].component, kids);
  assert.equal(wrapped.init, init);
  assert.equal(a._V_M_.launcher(), wrapped);
  const b = run({ _V_M_: { launcher: stock }, AlvidaaFreeMyTV: theirs });
  assert.equal(b._V_M_.launcher().route[0].component.marker, 'free-my-tv');
  assert.throws(() => run({ _V_M_: { launcher: stock } }), /Native Home component is required/);
  assert.throws(() => run({}), /Stock launcher factory is required/);
});

test('build refuses an unpinned stock bundle and assembles a runnable candidate', () => {
  const { build, PARTS, MARKER } = require('./build-native-alvidaa.cjs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alvidaa-build-'));
  const stockFile = path.join(dir, 'stock.js');
  const stock = '/* private vendor bundle */\nself._V_M_ = { launcher: function () { return { route: [{ path: "/Launcher", component: {} }] }; } };\n';
  fs.writeFileSync(stockFile, stock);
  const digest = hash(Buffer.from(stock));
  assert.throws(() => build(stockFile, null, ''), /expected sha256/);
  assert.throws(() => build(stockFile, null, '0'.repeat(64)), /does not match/);
  const candidate = build(stockFile, null, digest);
  assert.ok(candidate.startsWith('/* ' + MARKER));
  assert.ok(candidate.includes(stock));
  assert.ok(candidate.includes('AlvidaaNativeWallpaper="data:image/png;base64,'));
  for (const part of PARTS) assert.ok(candidate.includes(part));
  const context = {
    key: { KEYMAP: {} },
    _V_SDK_: { vre: { SDK: function () { return { key: { KEYMAP: {} } }; } } }
  };
  context.self = context;
  vm.runInNewContext(candidate, context);
  assert.equal(typeof context.AlvidaaNativeHome, 'function');
  assert.equal(context.AlvidaaNativeComponent, context.AlvidaaNativeHome);
  assert.equal(context._V_M_.launcher().route[0].component.name, 'Launcher');
  assert.throws(() => build(stockFile, path.join(__dirname, 'candidate.js'), digest),
    /must stay private/);
  fs.rmSync(dir, { recursive: true, force: true });
});
