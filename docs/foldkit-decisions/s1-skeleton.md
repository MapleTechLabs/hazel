# S1: Skeleton spike

Status: **passed** · 2026-10-07 · Branch `experiment-2.0`

Question: can Foldkit boot Hazel's stack (Clerk auth, Effect RPC, Electric/TanStack DB) and render a real screen pixel-identical to the React app?

## Result

`apps/web-foldkit` renders `/hazel/settings/team` at desktop size in both light and dark themes:

| Variant                       | Perceptual px | Strict px | Structural deltas | Missing / extra | Console errors |
| ----------------------------- | ------------- | --------- | ----------------- | --------------- | -------------- |
| settings-team, desktop, light | **0**         | 9         | **0**             | 0 / 0           | none           |
| settings-team, desktop, dark  | **0**         | 30        | **0**             | 0 / 0           | none           |

- Every text run and control has identical boxes and computed styles. The DOM dump matches the legacy one attribute for attribute; `bun parity` sorts attributes so the diff is meaningful.
- The few strict pixels are ±1 in one channel on the anti-aliased corners of the 3D-transformed facehash avatars (`perspective` + `corner-shape: squircle`). DOM and computed styles are identical there, and removing other layers from the legacy page doesn't change the result. This is compositor rasterization noise, not a styling difference. It stays on the known-gaps list.

## What was proven

- **Auth:** the Foldkit app reads auth through `window.Clerk` (the legacy `getClerkToken` and `AuthMiddlewareClientLive`), so the parity Clerk stub works unchanged.
- **RPC:** the Effect RPC client is a Foldkit `resources` layer (`src/rpc.ts`), using the same groups, NDJSON-over-HTTP transport and auth middleware as legacy. `user.me` runs as a Command.
- **Data (an early answer to S2):** the legacy TanStack DB collections import and run in Foldkit unchanged. The only blocker was one import in `libs/effect-electric-db-collection` (`createCollection` from `@tanstack/react-db`), which is a pure re-export of `@tanstack/db`. It now imports from core. `src/data/live-query.ts` bridges a live query into a Subscription (`liveQueryStream`) and **runs the exact query builder the legacy hook uses**, so filters, joins and even row order match. Dependent queries map naturally onto Subscription dependencies (org slug → organization → team members).
- **Theme:** the legacy `lib/theme/apply.ts` runs from a Command, driven by a `fromMediaQuery` Subscription. Dark mode matches.
- **Effect pin (S6):** Foldkit declares `effect@4.0.0` as an exact peer. Bun warns but resolves a single `effect@4.0.1` copy, and the app runs on it. No override is needed for now.

## How the views were built (the porting method)

1. **Reference DOM.** `bun parity capture legacy --filter <scenario>` writes `<variant>.html`, an indented dump of the rendered DOM with every class and attribute.
2. **Port the composition, not the output.** Each legacy component becomes a Foldkit view function that repeats the legacy `twMerge`/`tv` call with the same arguments (`src/ui/sidebar.ts`, `button.ts`, …). Class strings come out byte-identical in every state, with no hand-copied output.
3. **Share style definitions.** `tv()` definitions moved out of the legacy `.tsx` files into framework-free `*.styles.ts` files (button, badge, card) imported by both apps. `legacy-head` vs the pinned `legacy` parity run: 22 identical and 1 sub-perceptual pass, so the extraction changed nothing.
4. **Generate the rest.** `scripts/generate-icons.ts` renders all 92 legacy icon components (plus the logo) to SVG with `react-dom/server` and emits Foldkit functions. facehash was ported as a pure view (same hash, faces and inline styles).
5. **Codegen for one-off markup.** `bun parity codegen <file.html> --line N` turns any reference subtree into Foldkit code with class strings verbatim.

## Gotchas found (each one is now encoded in code or the harness)

| Gotcha                                                                                                            | Fix                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Legacy `cx` (`lib/primitive`) is React Aria's `composeRenderProps`. It returns a function and pulls in react-aria | Use `twMerge(twMerge(base), className)`, which is its string equivalent |
| `h.Style` rejects non-standard properties (`corner-shape`)                                                        | Raw `h.Attribute("style", …)`, as React writes it                       |
| Foldkit's first render **replaces** the container                                                                 | The view root is `div#app` itself, matching the legacy DOM              |
| Vite build target changes CSS color syntax (`oklch` → `lab` under `safari13`)                                     | Same `build.target` as legacy, so the stylesheets are byte-identical    |
| React Aria injects `[data-react-aria-pressable]{touch-action:…}` and sets `data-current` alongside `aria-current` | Same attributes and the same rule in the Foldkit CSS                    |
| Each target ran on its own port, so origin-printing UI differed                                                   | All targets captured through one canonical origin                       |
| Two identical _error_ screens counted as "identical"                                                              | Captures that crash or log errors now **fail**, whatever the pixels     |

## Not done in S1 (by design)

- Menus, dialogs and popovers (the org switcher, user menu and row actions are inert triggers for now). Phase 1 UI kit.
- Mobile layout (the legacy sheet sidebar and mobile nav). Phase 2.
- Unread notification badge on the nav rail. Phase 2, notifications.
- Route code splitting: the bundle is 1 chunk, 309 KB gzipped (Effect, TanStack DB, Electric, RPC client, one screen). Track it as screens land.

## Next

- S3 (editor) and S4 (chat list) are now the critical path.
- Phase 1 can start in parallel: extract the remaining `tv()` styles, port the UI kit with gallery scenarios, and fill scenario coverage.
