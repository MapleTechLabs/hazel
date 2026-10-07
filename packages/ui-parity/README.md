# @hazel/ui-parity

Pixel-level comparison of the legacy React frontend (`apps/web`) against the Foldkit frontend (`apps/web-foldkit`). It is the acceptance test for the migration: a screen counts as ported when its scenarios come back `identical`.

```bash
bun run parity build legacy                   # the pinned reference UI (LEGACY_BASELINE_REF in src/config.ts)
bun run parity build foldkit                  # build the Foldkit app from the working tree
bun run parity run                            # capture both, diff, write the report
```

## How it works

```
             ┌──────────────── fixture backend (one Bun process) ───────────────┐
             │  :4790 /rpc       real Effect RpcServer, handlers read the dataset │
             │  :4793 /v1/shape  Electric shape protocol, rows from the dataset   │
             └───────────────────────────────────────────────────────────────────┘
                    ▲                                         ▲
   :4791 legacy build (static)                  :4792 foldkit build (static)
   Clerk stub injected into index.html          same stub, same env, same data
                    ▲                                         ▲
                    └──── Playwright: same scenario, viewport, theme, clock ────┘
                                         │
                       pixels + structure diff → report
```

- **Same data in both apps.** Both apps are built with `VITE_BACKEND_URL` / `VITE_ELECTRIC_URL` pointing at the fixture backend (`src/config.ts`). Datasets live in `src/fixtures/datasets/` as typed rows with deterministic IDs (`stableId("user:ada")`).
- **No Clerk network.** `src/runtime/clerk-stub.ts` defines `window.Clerk` before the app boots. `@clerk/react` sees a loaded instance and never downloads clerk-js, and `getToken()` returns a fixed token. The Foldkit app has to read auth through `window.Clerk` too (as `apps/web/src/lib/clerk-token.ts` already does) for the stub to apply.
- **One origin.** Every target is captured through `http://localhost:4800`, proxied to the target's port, so UI that prints `location.origin` matches across targets. Playwright fulfils that origin in-browser and nothing binds it.
- **Parallel runs.** Ports are offsets from `PARITY_PORT_BASE` (default `4790`): backend `+0`, legacy `+1`, foldkit `+2`, Electric `+3`, legacy-head `+4`. Give each worktree or agent its own base (`PARITY_PORT_BASE=4900 bun run parity …`, then 5000, 5100). Builds embed the backend URLs, so a non-default base builds into `.parity/builds-<base>/` and `serve`/`run` refuse a build made for another base. Captures are byte-identical across bases.
- **Healthy captures only.** A capture that crashes, fails a step, or logs console errors (apart from known noise) marks its variant as `fail`, even when the pixels match. Two identical error screens are not parity.
- **Determinism.** Frozen clock (`dataset.now`), seeded `Math.random`, UTC, en-US, `deviceScaleFactor: 1`, animations and transitions frozen, carets and scrollbars hidden, service worker blocked, and every request outside the three local origins aborted. A capture waits for fonts and every image to decode, then for 400ms with no DOM mutations, then for two consecutive frames in which no scroll offset, scroll extent or image changes (late images make the chat list re-anchor). Anything that moved restarts the wait, up to the timeout. The screenshot is retaken until two in a row are identical, for motion only the compositor sees (the overscroll bounce after a wheel scroll). Fixture images are rendered when the backend starts, so the first capture of a run doesn't get them later than the rest. Infinite Web Animations (`element.animate`, motion's `repeat: Infinity`) are paused at the last frame of their first iteration, like the CSS freeze, and SMIL animations at t=0.
- **Two kinds of diff.**
  - *Pixels*: strict (any channel differs) and perceptual (pixelmatch, anti-aliasing ignored). Differing pixels are grouped into regions.
  - *Structure*: every visible text run and accessible control is recorded with its box and the computed styles that determine its look. Records are matched across apps by text or by role and name, never by DOM shape, because the two implementations won't share markup. Output reads like `font-weight: 600 → 500 on 18 text runs`, plus the elements that moved as a result.

## Workflows

### 1. Freeze the baseline (once, then whenever you deliberately change the reference)

```bash
bun run parity build legacy --ref <sha>   # worktree in ~/.cache/hazel-ui-parity, so main can keep moving
bun run parity selfcheck                  # captures legacy twice; must print "All variants deterministic."
```

Run `selfcheck` again after adding scenarios or datasets. A flaky scenario can't tell you whether the port is correct.

### 2. Side-by-side browsing

```bash
bun run parity serve      # fixture backend + every built target
```

Open `http://localhost:4791` (legacy) and `http://localhost:4792` (Foldkit) next to each other, both signed in as Ada with the same workspace. Use this to check interactions the scenarios don't cover yet. The clock isn't frozen here, so relative times can differ.

### 3. Port loop, one screen at a time (human or agent)

```bash
bun run parity build foldkit && bun run parity run --filter settings-team
```

1. Read `.parity/runs/<run>/summary.md`. Root causes are listed first (grouped style deltas), then knock-on moves, then elements missing from or extra in Foldkit.
2. Fix the Foldkit view and repeat until the variant is `identical`.
3. When it's not obvious, open `index.html` in the same run folder. It has swipe, onion skin, blink, side-by-side and diff modes (keys `1`–`5`, `j`/`k` to step through). Click a red region to highlight the elements responsible.

`--filter` matches a variant id substring (`chat-channel--mobile`) or an area (`settings`). The exit code is non-zero if anything fails, so the loop can be scripted.

### 4. Get the reference markup for a screen

```bash
bun run parity capture legacy --filter settings-team --run ref
bun run parity codegen .parity/runs/ref/legacy/settings-team--desktop--light.html --line 120 --name orgHeader
```

Every capture also writes `<variant>.html`, an indented dump of the rendered DOM with sorted attributes. Diff the legacy and Foldkit dumps to find attribute-level differences. `codegen` turns any subtree into Foldkit `h(...)` code with class strings kept verbatim. For components, prefer porting the legacy `twMerge`/`tv` call itself (see `docs/foldkit-decisions/s1-skeleton.md`) and use codegen for one-off markup.

### 5. Check that a legacy refactor is visually neutral

```bash
bun run parity build legacy-head          # working-tree legacy app
bun run parity run --baseline legacy --candidate legacy-head
```

Used by the `legacy-ui-guard` subagent (`.claude/agents/legacy-ui-guard.md`) for every change to legacy code.

### 6. Component gallery (UI kit primitives)

`/dev/gallery/<name>` renders every state of one primitive in both apps:

- Legacy: `apps/web/src/dev-gallery/entries/<name>.tsx` exports `title` and a `Gallery` component, picked up by a glob in `routes/dev/gallery/$component.tsx`.
- Foldkit: `apps/web-foldkit/src/gallery/entries/<name>.ts` exports `gallery = defineGallery(title, { Model, init, update, view })`, a self-contained program that `entry.ts` boots instead of the app on that path. Wrap the view in `galleryFrame` and `gallerySection` (`gallery/frame.ts`), the ports of `dev-gallery/frame.tsx`.
- Scenarios go in `src/scenarios/gallery.ts`. Static states (variants, disabled, invalid) are rendered by the entry; interactive ones (hover, focus-visible, pressed, open) come from steps, so they test behavior too.

A new legacy entry is not in the pinned baseline until the next re-pin. Until then compare against the working tree: `bun run parity build legacy-head && bun run parity run --baseline legacy-head --candidate foldkit --filter gallery`.

### 7. Track what's left

```bash
bun run parity coverage   # every legacy route, ✓ if a scenario visits it
bun run parity list       # every scenario × viewport × theme variant
```

### 8. Add a scenario

Add an entry to the area file `src/scenarios/<area>.ts` (an `AreaModule`: scenarios, the datasets the area introduces, and area-level canned RPCs). `src/scenarios.ts` only aggregates areas. Steps must use accessible locators (`getByRole`, `getByText`) so the same script drives both apps. If a step works in one app and not the other, that is a parity bug (wrong role or missing label), not a test bug. Add a dataset under `src/fixtures/datasets/` when a screen needs different data (empty org, long names, many unreads), and list it in your area module's `datasets`.

If a capture logs `unmocked RPCs: ...`, add a canned response to your area module's `rpc`, or to `dataset.rpc` if it is dataset-specific. `defaultHandlers` in `src/backend/rpc.ts` is for handlers every screen needs.

## Output

`.parity/` (gitignored):

- `builds/<target>/`: static builds
- `runs/<run>/<target>/<variant>.png|.json`: screenshots and structural snapshots
- `runs/<run>/diff/`: pixelmatch diff images
- `runs/<run>/summary.md`: agent-readable digest
- `runs/<run>/summary.json`: everything, machine-readable
- `runs/<run>/index.html`: interactive report

## Known gaps

- The legacy composer has role `combobox` and no accessible name, and the sidebar's drag handles all share the name "Drag". The Foldkit port should keep the roles visible users rely on, and the scenarios encode today's names.
- More legacy controls without a real accessible name, which the chat and navigation scenarios work around: message avatars are unnamed buttons unless the user has an uploaded avatar (scenarios open popovers from "Katherine Johnson" and "GitHub", whose images give the button a name); the sidebar section "+" buttons are all named "badge 13" (the icon's `<title>`, indexed in section order); the mobile header menu button is "menu" and the bottom-nav one "menu Menu"; the image viewer has no dialog role.
- Legacy tooltips (React Aria) open on hover only after a pointer interaction, so tooltip scenarios click the channel heading first. The emoji picker (frimousse) downloads emoji data from a CDN; `seedEmojiPicker` puts a small fixed set in its storage cache instead.
- Not capturable without network: URL unfurls (link previews and tweets call `link-preview.hazel.sh`, YouTube is an iframe, GIFs load from Giphy/Klipy, GitHub PR and Linear URL embeds call the HTTP API, not RPC). The `rich` dataset uses webhook-style `embeds` instead. Legacy has no unread divider (`isFirstNewMessage` is always false) and no channel members panel (the sidebar "Members" link goes to `/$orgSlug`).
- Fixture images (`/r2/*`, see `backend/assets.ts`) are flat colours. Captures with images still show sub-perceptual anti-aliasing noise at image and avatar edges between runs, which `selfcheck` tolerates (`pass`, 0%).
- Chromium only. Font rendering differs across OSes, so compare captures made on the same machine (or the same CI image), never a mix.
- Clerk's prebuilt `<SignIn>`, `<SignUp>` and `<CreateOrganization>` mount through `Clerk.mountSignIn` and friends, which the stub no-ops. The sign-in, sign-up, setup-organization and empty select-organization scenarios capture the surrounding page and the empty container, not the Clerk form. The Foldkit port mounts the same clerk-js components into the same container, so the form itself is Clerk's and stays out of scope.
- Signed-out scenarios use a dataset with `signedOut: true`: the stub installs Clerk with no session or user, and authenticated RPCs fail with `SessionNotProvidedError`. The app's Electric fetch then answers 401 locally for the collections it preloads; those console errors are expected there and ignored for signed-out datasets only.
- The onboarding timezone step runs infinite `motion` star animations. The Web Animations parts are frozen (see Determinism), but legacy animates the stars' `scale` from JavaScript every frame, so legacy captures still wait out the 8s quiet timeout. The frozen opacity is 0 in daytime, so the frame is deterministic.
- Electric live updates aren't simulated. Scenarios show steady state, and writes succeed without changing data. Optimistic-update visuals need dedicated datasets.
