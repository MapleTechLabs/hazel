# Hazel UI lanes (phase 2)

Phase 4 lanes (the rest of the web app, `W*` primitive lanes, `X*` foundations, `P*` pages, `Z*` the
swap) start from `docs/hazel-ui-phase4.md`, "Lane plan"; the rules below still hold. A `W*` lane
verifies with the phase 2 command of its web lane id (`verify:A1` to `verify:A5`) and
`test:web --lane <id> --tags <its tags>`.

The one brief a lane agent starts from. Background: `docs/hazel-ui.md` (read "Rules for implementing
agents" and "Testing"), the contracts in `CONTRACTS.md`, the resolved ledger in `GAPS.md`, and
`CLAUDE.md`. Every tag, prop, option, slot, event and its owning lane is in `src/vocabulary/spec.ts`.

## How a lane works

1. Branch from the harness branch (`t3/hazel-ui-harness`). Touch only your owned paths below.
2. Replace your stubs. Web: `src/web/primitives/<group>/<tag>.ts` is a `stubPrimitive(...)`; write a
   `definePrimitive(...)` renderer in its place. Swift: `HazelUI/.../Primitives/<Group>/Hz<Tag>.swift`
   draws a `NotImplementedView`; write the view from `HazelTheme` in its place. Recipes:
   `src/style/recipes/<tag>.ts` (lane D reviews them).
3. Fixtures: `src/conformance/fixtures/<tag>/<name>.json` (schema: `src/conformance/schema.ts`). The
   tag's web lane owns its folder and grows the `default.json` stub into real cases; the iOS lane may
   add files there, never edit the web lane's. `vitest run src/conformance` refuses a fixture that sets
   a prop the spec lacks, a value its schema rejects, or a default; for a tag the web draws, every
   option value and flag must appear in some case. A fixture with `pending: {web, ios}` waits on those
   lanes (the parity pass added one per new option): draw it, then delete your entry.
4. Snapshots (iOS lanes): run your verify command with `HAZELUI_RECORD=1`, look at every new PNG in
   `HazelUI/Tests/HazelUITests/__snapshots__/<tag>/`, then run it again without and commit them. A case
   records only once every tag in it draws (a `NotImplementedView` anywhere skips the case).
5. Kit diffs (web lanes): a fixture with `kit` is pixel-diffed against today's Foldkit component
   (G6 tolerance: channel 2, 0.15% of pixels). `src/conformance/known-diffs.json` lists the diffs known
   to fail, each with its lane; fixing one makes the runner fail until you remove its entry.
6. Verify with your one command (table). Stubs elsewhere report `not implemented: lane X` and skip;
   they never fail your command. Screenshots: `src/conformance/__shots__/` (web) and the iOS gallery.
7. Missing vocabulary: use the nearest option, mark the call `// HAZEL-GAP(<id>): <need>` and add a
   row under "Open" in `GAPS.md`. Never add a prop, option or tag in a lane.

Never edit: `bun.lock`, any `package.json`, `project.yml`, `.github/`, `.oxfmtrc.jsonc`,
`.oxlintrc.json`, generated files (`src/style/generated/`, `*.generated.swift`, `__goldens__/`),
`spec.ts`, `options.ts`, `content.ts`, `src/style/schema.ts`, `Hazel.ts`, or another lane's paths.
Never run `ui:generate`, `scripts/stubs.ts` or the formatter repo-wide; format only your own files.
No new dependencies. File-level `// @effect-diagnostics experimentalApiUsage:off` where Effect UI is used.

## Lanes

Paths: web and style under `packages/ui/`, Swift under `apps/ios/HazelUI/Sources/HazelUI/`.
Run each command from the repo root.

| Lane                                | Owns                                                                                                                                                           | Tags                                                                                                                                                                                                                                                                            | Inputs                                                                                                                                      | Verify                                        | Done when                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 Web: layout and content          | `src/web/primitives/{layout,content}/`, `src/web/icons.ts`, `src/web/extensions.ts`, recipes and fixtures of its tags                                          | stack, spacer, scroll, frame, divider, text, heading, icon, image, avatar, avatarStack, badge, progress, emptyState, richText, iconTile, channelIcon, peopleStrip, slot, ext                                                                                                    | tokens and recipes, the web's icons (`iconSources`), G6 kit specimens, today's `channelIcon`, `iconTile`, `ditherAvatar`, `kbd`             | `bun run --cwd packages/ui verify:A1`         | no case reports `not implemented: lane A1`, ARIA checks pass, its `known-diffs.json` entries fixed and removed                                          |
| A2 Web: controls                    | `src/web/primitives/controls/`, recipes and fixtures of its tags                                                                                               | button, link, textField, textArea, toggle, select, searchField, composer                                                                                                                                                                                                        | G5 revision pair (`src/native/revisions.ts`), today's `ui/button.ts` and fields                                                             | `bun run --cwd packages/ui verify:A2`         | same, plus `kit` fixtures per button variant and size within tolerance, keyboard and ARIA per control, the `select` command                             |
| A3 Web: overlays and focus          | `src/web/primitives/overlays/`, `src/web/focus/`, the `GifPicker` web registration, recipes and fixtures of its tags                                           | menu, contextMenu, sheet, dialog, popover, toast, tooltip, emojiPicker                                                                                                                                                                                                          | `MenuGroups` with one-level submenus, `popover.anchorTo`, the Foldkit app's popover and tooltip hosts                                       | `bun run --cwd packages/ui verify:A3`         | same, plus focus trapping and return, stacking with the app's hosts, the `measure` command                                                              |
| A4 Web: structure and list          | `src/web/primitives/{structure,list}/`, recipes and fixtures of its tags                                                                                       | list, listDivider, screen, navigation, tabBar, splitView, section, item, action                                                                                                                                                                                                 | G7's list behaviour, `list.loading` skeleton (renderer-owned)                                                                               | `bun run --cwd packages/ui verify:A4`         | same, plus virtualization and anchoring, `reorderable`/`move`, section `actionMenu`, the `scrollTo` command                                             |
| A5 Web: chat primitives             | `src/web/primitives/chat/`, recipes and fixtures of its tags                                                                                                   | message, reactionBar, attachmentGrid, embed, typingIndicator                                                                                                                                                                                                                    | `content.ts` `MessageRow` (readable keys), today's `chat/message/row.ts`                                                                    | `bun run --cwd packages/ui verify:A5`         | same, plus a message `kit` fixture against today's row within tolerance                                                                                 |
| B Native host (TS)                  | `src/native/` except `__goldens__/`                                                                                                                            | none (the wire for all)                                                                                                                                                                                                                                                         | `wire.ts`, the goldens, `Hazel.Host` commands                                                                                               | `bun run --cwd packages/ui verify:B`          | goldens pass, commands and replies round trip, nodes freed on removal, extensions cross with typed props, fixtures still compile to what the host sends |
| S0 Swift: Tree and registry (first) | `Tree/`, `Extensions/`, `apps/ios/EffectUiSpike/`                                                                                                              | ext; `Style`'s parity fields (`weight`, `uppercase`, `textAlign`, `lineClamp`, `overflow`, `align` end) and the mono step in `Tree/Styling.swift`                                                                                                                               | goldens, `Registry.generated.swift`, G8's observation                                                                                       | `bun run --cwd apps/ios verify:S0`            | goldens decode and apply, G8 holds, manifest check works, the spike app draws through `TreeView`, `-HazelScreen gallery` still launches                 |
| S1 Swift: layout and content        | `Primitives/{Layout,Content}/`, `Resources/`, the `resources` line of `HazelUI/Package.swift`, `apps/ios/scripts/export-icons.ts`, `__snapshots__/<its tags>/` | stack, spacer, scroll, frame, divider, text, heading, icon, image, avatar, avatarStack, badge, progress, emptyState, richText, iconTile, channelIcon, peopleStrip, slot; the HazelUI resources (icon catalog for every `IconName`, the `squirrel` illustration) and `HazelIcon` | `HazelTheme.generated.swift`, `apps/ios/scripts/export-icons.ts` (extend to `iconSources`), `web-foldkit/public/images/squirrle_ocean.webp` | `bun run --cwd apps/ios verify:S1`            | every case of its tags recorded and passing, none `not implemented: lane S1`                                                                            |
| S2 Swift: controls                  | `Primitives/Controls/`, `__snapshots__/<its tags>/`                                                                                                            | button, link, textField, textArea, toggle, select, searchField, composer                                                                                                                                                                                                        | G5's `HzTextField` in the spike app, `revisions.ts`                                                                                         | `bun run --cwd apps/ios verify:S2`            | same, plus the text-input stress test passes                                                                                                            |
| S3 Swift: overlays                  | `Primitives/Overlays/`, `__snapshots__/<its tags>/`                                                                                                            | menu, contextMenu, sheet, dialog, popover, toast, tooltip, emojiPicker                                                                                                                                                                                                          | system menus, sheets, popovers                                                                                                              | `bun run --cwd apps/ios verify:S3`            | same, with system components                                                                                                                            |
| S4 Swift: navigation and structure  | `Primitives/Structure/`, `__snapshots__/<its tags>/`                                                                                                           | screen, navigation, tabBar, splitView, section, item, action                                                                                                                                                                                                                    | the G8 views in `HzItem`, `HzSection`, `HzScreen`                                                                                           | `bun run --cwd apps/ios verify:S4`            | same, plus route and `NavigationStack` in sync both ways, tab bar, split view                                                                           |
| S5 Swift: list and chat             | `Primitives/{Collections,Chat}/`, `__snapshots__/<its tags>/`                                                                                                  | list, listDivider, message, reactionBar, attachmentGrid, embed, typingIndicator                                                                                                                                                                                                 | G7's `MessageListView`, `RowData` (readable keys), `ListSource`                                                                             | `bun run --cwd apps/ios verify:S5`            | same, plus `G7Tests` pass and G7's numbers hold with the real primitives                                                                                |
| D Tokens and recipes                | `src/style/tokens.ts`, `scripts/` except `stubs.ts` and `test-web.ts`                                                                                          | none (reviews every recipe)                                                                                                                                                                                                                                                     | seeds from `styles.css`, `*.styles.ts`, `web/look.ts`                                                                                       | `bun run --cwd packages/ui verify:D`          | every token and option filled from the seeds; after the integrator regenerates, `ui:check` passes                                                       |
| F Platform services                 | `packages/client-data/src/platform/`, `Runtime/`                                                                                                               | none; services `Files.pick`, `Files.dropped`, `Clipboard.write` (`platform/ui-services.ts`) and the data-layer services                                                                                                                                                         | `services.ts`, `ui-services.ts`, G3's Swift-backed services                                                                                 | `bun run --cwd packages/client-data verify:F` | every service with web and Swift implementations, the JSC bundle builds, HazelUI compiles, G3 still passes                                              |

What each command runs:

- **A1 to A5:** `packages/ui` typecheck, `vitest run src/web src/conformance`, then `test:web --lane <lane>`
  (Chromium, light and dark, 1180 and 390 wide; only the lane's tags).
- **B:** typecheck, `vitest run src/native src/conformance`.
- **D:** typecheck, `ui:check`, `vitest run src/style scripts/generate.test.ts`.
- **S0 to S5:** `apps/ios/scripts/test-hazelui.sh <lane>`: builds the G7 bundle, creates the pinned
  simulator when missing (`hazel-ui-ci`, iPhone 17 Pro, iOS 26.4 runtime), runs `xcodebuild test -scheme
  HazelUI` with `TEST_RUNNER_HAZELUI_LANES=<lane>`: `SnapshotTests` (light and dark, compact 402pt and
  regular 820pt; tolerance channel 4, 0.2% of pixels), plus `GoldenTests` and `RedrawTests` for S0 and
  `G7Tests` for S5. S0 also builds the spike app. Log: `HazelUI/.build/test-hazelui.log`; failed images:
  `HazelUI/.build/snapshot-failures/`.
- **F:** client-data typecheck and tests, the live JSC bundle, `test-hazelui.sh F` (compiles HazelUI and
  its tests; Runtime has no tests yet).

Whole suite (integrator, CI): `bun run --cwd packages/ui test`, `bun run --cwd packages/ui test:web`,
`bun run --cwd apps/ios test:hazelui`; contract checks `bun run --cwd packages/ui test:contracts`.
CI: `.github/workflows/hazel-ui.yml` (a Linux web job and a macOS simulator job) on PRs touching
`packages/ui`, `packages/client-data`, `apps/shared-screens` or `apps/ios`.

## Page parity (phase 4)

`bun packages/ui/scripts/compare-pages.ts` diffs each hazel page against the Foldkit screen it
replaces, over the offline web build (`apps/ios/build/web`), 390 and 1180 wide, light and
dark, with a pinned clock and reduced motion. It only needs a URL, a flag and steps, so it works the
same whichever side is the app's root.

1. Register the page: `apps/web-foldkit/src/parity/pages/<id>.ts` default-exports a `ComparePage`
   (`parity/compare-entry.ts`), data only:

    ```ts
    import type { ComparePage } from "../compare-entry"

    export default {
    	flag: "hazel:page:settings-profile",
    	href: "/hazel/settings/profile",
    	island: '[data-page="settings-profile"]',
    	wide: true,
    	// Optional: `tab` (the phone tab bar's tab for `href`), `region: "viewport"` for a menu or
    	// dialog drawn outside the page's slot (1180 wide compares the slot by default).
    	steps: [{ click: 'button:has-text("Edit")' }, { at: "compact", press: "Escape" }],
    } satisfies ComparePage
    ```

    Steps run in order after the route opens: `click`, `hover`, `press` (a key), `fill` + `text`,
    `waitFor`, `route` (in-app navigation); `at: "compact" | "regular"` limits one to a width.
    Selectors are Playwright's.

2. Fixture data, if the page needs rows or RPC answers the shared fixture lacks:
   `apps/ios/fixture/pages/<id>.ts` default-exports a `PageFixture` (`fixture/page-fixture.ts`):
   `seed(server)` writes rows (`server.write(kind, sourceId, table, rows)`), `rpcs` answers RPCs by
   tag. Only the page under test gets its fixture (the harness names it under `hazel:fixture:page`),
   on both sides, so pages never move each other's numbers. The fixture is in the build: rebuild
   after changing it.

3. Run it (from the repo root):

    | Command                                                        | What it does                                                                                                                                                                                               |
    | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `bun packages/ui/scripts/compare-pages.ts --build --only <id>` | rebuilds the offline app, then shoots flag off (today) and on (hazel); strips (today, hazel, diff) to `docs/hazel-ui-screens/phase4/<id>/`                                                                 |
    | `... --only <id> --probe`                                      | also pairs both sides' text runs and prints each that moved or changed type                                                                                                                                |
    | `... --only <id> --strict`                                     | exits 1 when a shot has residue past a channel delta of 5 (the tolerance), as well as when the page did not mount                                                                                          |
    | `... --baseline --only <id>`                                   | today is the left panel of the committed strip in `docs/hazel-ui-screens/phase4/<id>/` (`--from <dir>` for another); only the hazel side runs; strips go to `node_modules/.cache/compare-pages/` (`--out`) |

    `--only` takes a comma list; without it every registered page runs. Each line prints the share of
    pixels past a channel delta of 2, the count and the max delta; `OVER TOLERANCE` past 5,
    `PAGE DID NOT MOUNT` when the hazel container is missing at a width the entry covers (exit 1).

4. Before deleting the Foldkit page, commit its strips under `docs/hazel-ui-screens/phase4/<id>/`:
   they are its baseline from then on, and `Z1` runs `--baseline` for every page.

The phase 3 islands are registered too (`channel-sidebar`, `dms`, `activity`, `channel`). On
2026-11-27: sidebar 0.002 to 0.003% (max delta 4), DMs 0.000% (390 only), activity 0.000 to 0.001%
(max delta 5), the channel list 0.35 to 0.40% (the open `divider-stuck-line` gap), the same live
and in baseline mode.

## Galleries

- Web: `bun run --cwd packages/ui gallery:dev`, then `/fixtures.html` (every case light and dark,
  regular and compact) or `/primitives.html?lane=A4&theme=dark`. The kit parity gallery is `/index.html`.
- iOS: build with `bash apps/ios/scripts/build-effect-ui.sh`, launch `EffectUiSpike` with
  `-HazelScreen gallery`: every case through `TreeView`, filterable, with Dark and Regular toggles.

## Integrator only

Adding a tag (a contract change the user approved): edit `spec.ts`, run `bun scripts/stubs.ts` (web
stub, Swift stub, default fixture) and `bun run --cwd packages/ui ui:generate`, add a recipe file.
Changing a wire stream: `bun scripts/wire-goldens.ts`. Merging lanes: rerun the whole suite.
