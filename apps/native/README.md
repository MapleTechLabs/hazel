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
  `HAZEL_SESSION_TOKEN` as the session bearer (`bun run dev:sign-in` prints one).

## Run

```sh
bun run host:build                 # the Rust host (Rust 1.99.1 per host/rust-toolchain.toml)
bun run build                      # the bundled runtime (dist/entry.js)
HAZEL_NATIVE_ENTRY=dist/entry.js host/target/release/hazel-native
```

Without `HAZEL_NATIVE_ENTRY` the host runs `src/entry.ts` directly (slower boot, no build step).
`NATIVE_THEME=dark`, `NATIVE_WIDTH`/`NATIVE_HEIGHT` set the window; `NATIVE_DEBUG=1` logs every
Message and editor event; `NATIVE_STATS=<file>` appends per-commit timings.

`host/target/release/hazel-native --capture script.json` runs headless on a real-time frame loop and
follows a script (`settle`, `waitText`, `clickText`, `focusEditable`, `type`, `key`, `snap`, `dump`),
writing timings to `NATIVE_BENCH_OUT`.

## Benchmark

```sh
bun bench/run.ts --runs 5          # native capture and the same scenario in Chromium (bench/web)
```

Writes `bench/out/report.md`: boot to messages on screen, key to frame, Enter to the sent message,
frame CPU and memory, medians of each.

## Not yet native

- Images (avatars draw as placeholders) and emoji glyphs (no emoji font is loaded yet), iframes and
  HTML embeds.
- Interaction styles (`focus:`, `active:`, `disabled:`), animations, box-shadow rings.
- Mounts other than the message list and the composer (popovers, menus, pickers) do not acquire.
- Grid is emulated with flex rows: Rune does not expose Taffy's grid templates yet.
