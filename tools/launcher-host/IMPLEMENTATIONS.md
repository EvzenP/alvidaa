# Lane 3 implementations

Lane 3 is the native lane: a component that replaces `route[0].component` for
`/Launcher` inside the writable vendor bundle, so the TV runs a native home
screen instead of a browser page. No bounce, no watcher, no server on the TV.

This directory holds every lane-3 implementation. It is one directory on
purpose: the route swap, the SDK adapters and the rollback discipline are
shared, and only the design and the per-build constants differ.

## What is here

| Implementation | Author | Target build | Entry point | State |
| --- | --- | --- | --- | --- |
| **Free My TV** (generic) | [@JacksonDCollins](https://github.com/JacksonDCollins) | 55A7KAU / `09.09O.P1015` | `free-my-tv-native.js`, `native-web-*.js`, `build-native-web.cjs` | merged, owner-verified on that unit |
| **Free My TV** (75U8QTUK port) | [@Kingpandacc](https://github.com/Kingpandacc) | 75U8QTUK / `09.60I.Q0813` | `free-my-tv-native-75u8qtuk.js`, `native-platform-75u8qtuk.js`, `build-native-75u8qtuk.cjs` | merged, owner-verified on that unit |
| **alvidaa design** | unbuilt | any | — | not started, see issue #35 |

Both Free My TV variants are the same product: an offline clock-and-shelf home
that lists apps and inputs through the vendor SDK and opens the real stock
Settings. The 75U8QTUK entry is a per-build port of the generic one, which is
the pattern to copy rather than a second product.

### Who got there first

Worth knowing, because the two contributions are easy to conflate:

- **First code:** JacksonDCollins, PR #24 (2026-11-07 01:24). That is where
  `native-entry.js` and `native-home.cjs` came from, on the 55A7KAU.
- **The write-up the approach is learned from:** Kingpandacc, PR #28
  (2026-11-07 16:20). `docs/models/75U8QTUK/…/findings/09-native-home.md` is
  still the canonical description of the preflight, the route swap, the SDK
  contract table and the rollback.

If you are implementing lane 3, read the 75U8QTUK findings and reuse Jackson's
scaffold. They are complementary, not competing.

## The shared pieces

Every implementation in this directory uses these:

| File | What it does |
| --- | --- |
| `native-entry.js` | the route swap: wraps the stock launcher factory and replaces one route component |
| `native-platform.js` | the SDK adapter. Contracts differ per build, so this is the file that gets a sibling when a new build arrives |
| `native-home.cjs`, `native-launcher.js` | the component scaffolding and the shared view logic |
| `native-trial.cjs`, `stock-ui-restart.cjs` | the reversible trial: install, verify, restore |
| `*.test.cjs` | `node --test tools/launcher-host/native*.test.cjs` |

## Adding an implementation

1. **Do not fork the directory.** Add a per-build adapter (`native-platform-<model>.js`) and a build script, and reuse `native-entry.js` and the trial machinery.
2. **Read `docs/models/<model>/<firmware>/findings/09-native-home.md`** for the build you are targeting. The 75U8QTUK one is the canonical write-up of the approach: what to pin before touching anything, which route to replace, and what the SDK contracts look like there.
3. **Pin the stock file before editing.** Size, owner, mode, md5 and sha256, copied somewhere private. The 75U8QTUK findings show the shape.
4. **Write the rollback first.** These implementations replace a vendor file. If the rollback is not written down before the first write, it is not reversible.
5. **Label it unverified** until it has run on hardware. Nothing in this directory is verified by tests alone.

## What lane 3 is not

- Not a place for the canvas launcher. That is lanes 1 and 2, and it lives in `launcher/`.
- Not a place for binaries. Vendor bundles are read at runtime, never vendored.
- Not a place to modify vendor files in the repo. The swap is a runtime wrapper appended after the stock bundle.
