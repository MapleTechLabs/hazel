# Hazel on Rune

Hazel's own Foldkit app (`apps/web-foldkit`: the same `init`, `update`, `view` and
`subscriptions`) drawn natively by [Rune](https://github.com/anomalyco/rune), a GPU UI framework in
Rust. The web build is untouched; this is a second renderer for the desktop.

```
Rune host (Rust, host/)                     Bun runtime (src/entry.ts)
  window, layout, text, GPU                   Foldkit runtime with a RenderTarget
  draws the wire tree        <── trees ───    view -> VNodes -> styles resolved -> wire tree
  presses, edits, layout     ─── events ──>   events -> the VNodes' own handlers -> Messages
```

- **Foldkit** renders into a `RenderTarget` instead of a DOM container (patched in via
  `patches/foldkit@0.170.0.patch` until a release ships it).
- **`@hazel/foldkit-rune`** turns each committed Document into the wire tree: Tailwind classes are
  resolved with Tailwind's own compiler and `src/styles.css` (custom properties, variants, `:has`,
  descendant rules), handler ids are stable per element, and unchanged subtrees go as references.
- **Mounts** that measure geometry (the message list) run against element proxies backed by the
  host's layout; the composer's ProseMirror editor runs on a headless DOM with a native text field
  drawn over it.
- **Data**: `HAZEL_DATA=offline` (default) serves a fixture org over a local sync socket and answers
  the few HTTP calls in `src/offline-backend.ts`; `HAZEL_DATA=live` talks to `VITE_BACKEND_URL` with
  `HAZEL_SESSION_TOKEN` as the session bearer (`bun run dev:sign-in` prints one), or without one
  signs in through the browser and keeps the session in the keychain (see Mac app).

## Run

```sh
bun run host:build                 # the Rust host (Rust 1.99.1 per host/rust-toolchain.toml)
bun run build                      # the bundled runtime (dist/entry.js)
HAZEL_NATIVE_ENTRY=dist/entry.js host/target/release/hazel-native
```

Without `HAZEL_NATIVE_ENTRY` the host runs `src/entry.ts` directly (slower boot, no build step).
`bun run build` also writes `dist/styles.json`, the stylesheet compiled for every class the app's
sources use, so the bundled runtime boots without Tailwind's compiler; a class the scan missed
compiles after the commit that shows it, and the screen restyles.
`NATIVE_THEME=dark`, `NATIVE_WIDTH`/`NATIVE_HEIGHT` set the window; `NATIVE_DEBUG=1` logs every
Message and editor event; `NATIVE_STATS=<file>` appends per-commit timings.

`host/target/release/hazel-native --capture script.json` runs headless on a real-time frame loop and
follows a script (`settle`, `waitText`, `clickText`, `focusEditable`, `type`, `key`, `snap`, `dump`,
`exportLayout`), writing timings to `NATIVE_BENCH_OUT`. A step that cannot complete fails the run.

## Mac app

```sh
bun run bundle                     # dist/Hazel Native.app, ad-hoc signed and registered
HAZEL_BACKEND_URL=http://localhost:3003 HAZEL_APP_URL=http://localhost:3100 bun run bundle
```

The bundle holds the release host, the runtime compiled to one executable (`bun build --compile`,
ESM bytecode) as `Contents/MacOS/hazel-runtime`, `styles.json` and the web app's `public/` in
`Contents/Resources`. Its Info.plist registers `com.hazel.native://` and sets `LSEnvironment`:
live data against production (`https://api.hazel.sh`, `https://app.hazel.sh`) unless the
`HAZEL_*_URL` overrides above were set when bundling. Those apply only when Launch Services
starts the app (Finder, `open`); running `Contents/MacOS/hazel-native` from a shell takes the
shell's environment.

**Sign-in.** Live without `HAZEL_SESSION_TOKEN`, the app signs in like the Tauri app
(`web-foldkit/src/platform/desktop-auth.ts`, reused as is): `src/desktop-bridge.ts` answers the
three Tauri calls it makes. The browser opens `/auth/desktop`, which hands back
`com.hazel.native://auth/callback?...`; the host receives that Apple Event (Rune's
`App::on_open_url`) and passes it on as `openUrl`. The session lives in the login keychain
(service `com.hazel.native`, account `auth`), read and written by the host with the `keyring`
crate as the Tauri app does, so only the host binary is on the item's access list. After a
rebuild the ad-hoc signature changes, and macOS asks once to allow the new binary.
The app signs in as the `native` client (`@hazel/auth` `nativeClient`), its own scheme, so a Mac
with the Tauri app installed routes each callback to the right app.

A full page load in the app (`load("/")` after sign-in, `location.reload()`) sends `reload`: the
host replaces the runtime with a fresh one at that path, as a browser reloads the page.

## Benchmark

```sh
bun bench/run.ts --runs 5          # native capture and the same scenario in Chromium (bench/web)
```

Writes `bench/out/report.md`: boot to messages on screen, key to frame, Enter to the sent message,
frame CPU and memory, medians of each.

## Conformance

```sh
bun run conformance                # native vs Chromium: element rects and pixels, light and dark
bun run --cwd ../../packages/foldkit-rune test   # resolved styles vs Chromium's computed styles
```

`bench/conformance` renders the same scenarios natively and in Chromium, matches elements and
compares their rects and the pixels; `--check` holds the results to `thresholds.json`. The style
suite in `packages/foldkit-rune` replays what Chromium computed for every element of the app and a
synthetic utility page (`conformance:extract` records it).

## Not yet native

- Overlays beyond the modal popovers: tooltips (`AnchorTooltipPanel`), submenus
  (`PositionSubmenu`) and the image viewer.
- Colours a `focus:` variant changes (Rune draws focus as a ring only), focus or press state on an
  ancestor (`group-focus-visible:`), and spinners drawn as rotating CSS border rings.
- Subgrid: Taffy has none, so a subgrid row lays its children out on its own copy of the tracks.
- `text-box` trimming, vertical margin collapsing (spacing is the same, a block's own box is not),
  fractions of the parent's height, and percentage insets (`left-1/2`).

Rune is pinned to `Makisuo/rune` (anomalyco/rune `bca4713` plus grid tracks) until grid tracks
land upstream; see `host/Cargo.toml`.
