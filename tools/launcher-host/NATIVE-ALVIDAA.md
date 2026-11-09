# alvidaa native Home

Our design, as a lane-3 component. Written against the shared scaffold; **not yet
run on hardware**. Nothing here is verified by tests alone.

## What it is

`native-alvidaa.js` is a Vue component that replaces only the `/Launcher` route
component, exactly like Free My TV. It is not a second product: the route swap,
the SDK adapter, the install/restore machinery and the rollback path are the
shared ones.

The design is the canvas launcher's r4 layout, ported to DOM:

| Piece | Where |
| --- | --- |
| clock and date | top left, hours/minutes hierarchy, uppercase date |
| inputs dock | bottom edge, five 320×176 tiles per page |
| big label | the focused input's real name above the dock, `connected` / `no signal` under it |
| Apps tile | one door; opens the app list as an overlay, 5-column grid |
| Settings tile | opens the real stock TV Settings |
| toast HUD | bottom center, floating glass pill for action feedback and alerts (default 2500ms, timed expiry) |

Two views, panned vertically like the canvas: view 1 is the dock, view 2 is the
apps row. ArrowDown pans, ArrowUp or Back pans back. Back at the dock is handed
to the vendor, so the stock behaviour from Home still works.

No canvas, no iframe, no global CSS. Everything is inline style plus CSS
gradients, which the 75U8QTUK findings confirmed paint on this engine. The
wallpaper is a PNG generated at build time and inlined as a data URI, so the
candidate stays one self-contained file and the repo carries no image asset.

The one network path is the vendor's own icon host, and only that host. See
*Icons* below.

## Data contracts

The component consumes `native-platform.js`, which is where builds differ:

- apps: `app-service.getCurrentShowApps("Launcher")` on 55A7KAU builds,
  `getAppList({sceneCode:"launcher"})` on 75U8QTUK builds
- inputs: `all-inputs.getAllInputsData()`
- input name order: `displayname2` → `rename` → `name` → `sourceId`, with an
  `LA####` translation id resolved through `sdk.i18n.t` (same order as the
  bridge, so the dock reads "PlayStation 5", not "HDMI2")
- signal: `is_signal` / `has_signal` as `1`, `"1"` or `true`
- launch: `sdk.apc.start` through the platform adapter; APC keeps PIN, EULA and
  hotel-mode checks
- settings: `setting.open("settings")`

### Toast HUD

Feedback and error messages are displayed via a floating glass HUD pill rendered in the root layer above the stage:

- `toast` (message text) and `toastUntil` (epoch timestamp deadline) live in the component's reactive data.
- `showToast(text, ms)` sets the active message and deadline, defaulting to 2500ms if unspecified.
- Action failures from `run()`, empty overlay notices ("No apps reported"), and activation notices route through `showToast`.
- The 1s clock interval drives toast expiry, clearing expired messages and triggering smooth opacity and transform transitions.

### Icons: local files, then the vendor host

App records are checked in order for `img`, `presetImg`, `icon`, `appIcon`,
`icon_local_url`, `iconLocalUrl`, `localIcon`, `httpIcon` and `icon_web_url`.
A `data:image…iconDownload<url>` trampoline is unwrapped first, because some
builds wrap the URL that way.

Two kinds of value are accepted:

- **local** — `var/local/storeAppIcon/…`, `file:///…`, an absolute path, or an
  inline `data:image` PNG/JPEG/WebP
- **the vendor's icon host** — `https://*.vidaahub.com/…` only

Anything else is refused, so this cannot become a general web client. That is
the same host the stock launcher and the 75U8QTUK port load, and it is what
gives real app icons on builds that expose no local files.

When neither is available, the overlay draws a letter badge in the app's brand
colour (Netflix red, YouTube red, Prime blue, Spotify green, Plex gold, and so
on) rather than a random hue.

If you want zero network access, drop the vidaahub rule in `allowedIcon()`.
Every app then falls back to its badge, which is the trade the first version
made.


## Build

```sh
node tools/launcher-host/build-native-alvidaa.cjs \
  <private-stock-app.js> <expected-sha256> <private-output.js>
```

The expected hash is a required argument. A build that cannot state which stock
revision it targets cannot be rolled back safely, so the script refuses to
guess. Output must stay under `firmware/` or `/tmp/`, same as the Free My TV
build.

The candidate is: stock bundle, then `native-platform.js`, `native-alvidaa.js`,
`native-entry.js`. `native-entry.js` picks the variant from
`AlvidaaNativeComponent`, which `native-alvidaa.js` sets; Free My TV builds have
no such global and fall back to `AlvidaaFreeMyTV`.

## What to verify on hardware, in order

1. **Preflight and pin** the stock file (size, owner, mode, md5, sha256) before
   any write. `docs/models/75U8QTUK/…/findings/09-native-home.md` is the shape.
2. **Does this build have the writable bundle?** The reference `50A51HUV` /
   `09.01O.P0813` has `/APPS/channelA/hisenseUI/` and no
   `tv.vidaa.app.operationui` under `/APPS/pkgs/`. If the module is absent,
   lane 3 does not apply to that build and the `hisenseUI` route is the only
   option, with the caveats in the 55A7KAU findings 05 and 12.
3. **First paint** with the stock app list and inputs. If the dock is empty,
   the platform contract is wrong for that build, not the design.
4. **Input names.** If they read `HDMI2`, the build does not expose
   `displayname2` and the adapter should say so rather than guess.
5. **Key dispatch.** Arrows, OK and Back must not double-fire: the component
   listens on `key-down` at the body in the bubbling phase and stops
   propagation only for keys it handled.
6. **Back at the dock** must still reach the vendor. If it does not, the
   handler is eating too much.
7. **Launch and Settings** through APC, including a parental-locked app, to
   confirm no bypass flags leaked in.

## Rollback

Unchanged from the shared path: `native-home.cjs restore` puts the pinned stock
files back and restarts the engine. Do not test this variant without a written
rollback and a private copy of the stock bundle.

## Tests

```sh
node --test tools/launcher-host/native-alvidaa.test.cjs
```

Covers start/stop idempotence, app and input filtering, name precedence,
smart focus, dock and overlay navigation, Back ownership, action failures,
toast HUD timing and expiry, render structure and scaling, the entry's variant
selection, and the build's hash and output guards.
