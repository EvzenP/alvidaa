# preview-native-home — the native Home in a browser, no TV

Every visual change today costs a deploy and a human looking at a TV. That is
why the last icon took five rounds. This command puts the **real component**
— the same `native-alvidaa.js` the build ships — into a browser tab on a
laptop: same render tree, same styles, same fixture-driven state machine, no
TV and no deploy.

```
node tools/launcher-host/preview-native-home.cjs [--port 8080]   # serve, open the URL
node tools/launcher-host/preview-native-home.cjs --out preview.html   # one static file
```

`--out` writes the same self-contained page to a file (useful for
screenshots); it renders immediately on load, with or without a network.
Either way the page carries three things:

1. **The real component source**, embedded inline, running against a stub
   SDK exactly the way [native-alvidaa.test.cjs](native-alvidaa.test.cjs)
   runs it.
2. **A server-side snapshot** of the fixture state as real markup, so the
   Home is visible even before (or without) JavaScript.
3. **The live boot**: the component instance re-created in the page, its
   `render(h)` tree turned into DOM by a ~30-line `h` → element function
   (numbers resolve like Vue's style binding — px except the unitless
   properties), keyboard and clicks wired back to it, redraw after every
   key, click and clock tick. No framework, no bundler, no npm install.

The red banner reads **"stub preview — not device-verified"** and stays on
screen. It is there so nobody screenshots the preview and calls it a deploy.

## The fixture

A living room, not a lab: six inputs with mixed signal state and the names a
real room reports ("TV", "PlayStation 5", "Fire TV Stick", "Nintendo
Switch", "Steam Machine", and one nameless HDMI port), ~40 apps covering
every tile shape the dock shows — six with allowlisted PNG tile icons (the
app-icon allowlist accepts `data:image/(png|jpeg|webp)` but not svg+xml, so
the fixture generates real PNGs), the rest falling back to letter badges
with the component's brand colours, plus the entries the component filters
out (browser home, stock home, a blank name). Three favorites come from
`alvidaa_favorites`, so the dock's favorite tiles render with their real
icons. Device art is the **real baked `AlvidaaNativeDeviceArt` rules** and
the wallpaper is the real generated PNG — the same payloads a build inlines.

Keyboard works like the TV: arrows move focus, Enter activates, Backspace
closes the overlay. One bridge makes that true: the component listens for the
vendor's custom `key-down` event (what the TV's shell dispatches), which real
browser keypresses (`keydown`) never fire — so the page bridges real keydown
events to the **component's own `handleKey`** and re-draws, consuming keys
that handle it (`preventDefault`) so arrows and Enter never scroll. Nothing
here reimplements navigation; if the component's key handling changes, the
preview follows automatically. (The bridge was caught on the first real
browser pass — a redraw-only listener passed every node:test and still made
the keyboard a no-op. A parse check is not a keypress.)

## What a preview cannot show

- **Engine quirks.** This engine paints neither SVG data URIs nor the vendor
  icon font outside its own components (findings 13 §8) — a laptop happily
  paints both. The device shapes are divs precisely because they must
  survive the engine, but any SVG that appears on a laptop is a lie the TV
  will not tell.
- **Real icons.** `var/local/storeAppIcon/` files exist on the TV; the
  fixture substitutes generated PNG tiles. Icon *layout* is real, icon
  *content* is not.
- **Timing.** First-frame placeholders, the payload pop-in, the watcher
  bounce, idle-screen fade timing — all deploy-time behaviours.
- **The candidate, not the tree.** The preview renders the *source* component;
  a built candidate (baked input art, per-model parts) is a different file.

One line, because it belongs everywhere: **a preview is not verification.**
The verification lane is still `tools/screenshot.sh` and eyes on the TV
(findings 13 §8). What the preview kills is the deploy round trip for
design questions — "what does the dock look like with these names?" — not
the question "does it render on the engine?".

## Tests

```
node --test tools/launcher-host/preview-native-home.test.cjs
```

Thirteen cases, no browser needed: the fixture loads the component exactly
like the component's own tests (36 apps after filtering, six inputs, one
registered key listener); inputs carry mixed signal and the living-room
names; the fixture covers every tile shape (PNG-tile apps, badge apps,
filtered apps); the tree converts into DOM-shaped objects (ids, px-resolved
numeric styles, unitless opacity, `on.click` surviving, the favorite's
`<img>`); device shapes are border/background divs and no SVG elements
exist; arrows move dock focus with exactly one focused tile; the Apps tile
opens the overlay and Backspace closes it; a favorite launches through the
platform stub; the overlay pages and launches the focused app; `--out`
writes a self-contained file carrying the banner, fixture names, component
source, baked rules, wallpaper and rendered snapshot markup; the served page
answers identically; the embedded scripts parse as JS **and the boot script bridges real keydown to handleKey** (the component registers the vendor key-down event, which browser keypresses never fire); and the CLI usage
contract.
