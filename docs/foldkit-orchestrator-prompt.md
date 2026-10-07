# Orchestrator prompt: continue the Foldkit migration

Paste the block below into a fresh Claude Code session at the repo root.

````text
You are the orchestrator for Hazel's React → Foldkit frontend migration. Your job is to plan, delegate to subagents, integrate their work, and verify it with the parity harness. Write as little code yourself as possible: integrate, review and verify.

## Context (read these first, in this order)
1. CLAUDE.md, plus the memory note that the real backend is apps/backend (not backendv2).
2. docs/foldkit-migration.md: the plan, phases, definition of done (§5), decisions (§8).
3. docs/foldkit-decisions/s1-skeleton.md: what S1 proved, and the porting method and gotchas. Follow them exactly.
4. packages/ui-parity/README.md: the harness (fixture backend, scenarios, run/capture/codegen/selfcheck/coverage, legacy-head).
5. apps/web-foldkit/src: the working Foldkit app (main.ts, route.ts, data/live-query.ts, shell/app-shell.ts, page/team.ts, ui/*).
6. Foldkit conventions: clone https://github.com/foldkit/foldkit to your scratchpad and read AGENTS.md, packages/website/src/page/ (Mount, Subscription, Submodel, testing) and skills/. Follow its naming rules: Messages are past-tense facts, Commands are verb-first, never NoOp.

Work on branch `experiment-2.0`. Commit in logical units with the repo's attribution trailer, and push when a milestone is green.

## Hard rules (put these in every subagent brief)
- Never start a dev server. The harness builds static bundles (`bun run parity build <target>`).
- Parity is the acceptance test. A screen is done when its scenarios are `identical` (or `pass` with only sub-perceptual strict pixels, explained), with no console errors and no unmocked RPCs.
- Never edit the baseline, scenario expectations or tolerances to make a diff disappear. Fix the port.
- Port the legacy class composition (the same twMerge/tv arguments), not hand-copied output. Move legacy `tv()` definitions into framework-free `*.styles.ts` files imported by both apps.
- Any change under apps/web, libs/ or shared styles must be visually neutral. Prove it with the `legacy-ui-guard` subagent (or `bun run parity run --baseline legacy --candidate legacy-head`) before committing.
- Scenario steps use accessible locators only (getByRole/getByText). A missing role or label in Foldkit is a port bug.
- Use branded ID types from @hazel/schema; follow the Effect patterns in CLAUDE.md.
- The legacy baseline is pinned at 0126176e0: `bun run parity build legacy --ref 0126176e0`.

## Step 0: make the harness safe for parallel agents (do this yourself, first)
The harness uses fixed ports (4790–4794 and the canonical origin 4800), so two worktrees running parity at once will collide. Add a `PARITY_PORT_BASE` env var (default 4790) that offsets every port in packages/ui-parity/src/config.ts and capture.ts (CANONICAL_ORIGIN). Make sure builds still embed the correct backend URLs per base. Verify `bun run parity selfcheck --filter settings` passes with two different bases running at the same time. Commit.
From then on, give each subagent its own `PARITY_PORT_BASE` (4900, 5000, 5100, …) and run it with `isolation: "worktree"`.

## Workstreams (launch in parallel where noted)
Each subagent gets a self-contained brief: goal, files to read, rules above, exit criteria, its PARITY_PORT_BASE, and "report: commands run, run folder, parity totals, files changed, open issues".

A. S3 editor spike (1 agent, critical path). Replace the Slate composer for Foldkit. Prototype ProseMirror and Tiptap (vanilla) inside a Foldkit Mount (`Mount.defineStream` emits doc changes); evaluate Lexical on paper. Port the legacy markdown serializer and make its 1014-line test suite (apps/web/src/components/chat/slate-editor/slate-markdown-serializer.test.ts) pass against the new document model. Exit criteria: the composer scenarios `chat-composer-focused` plus new empty and with-draft scenarios are identical inside the ported chat shell, or inside a minimal harness page if the shell isn't ported yet; mention autocomplete opens. Deliverable: docs/foldkit-decisions/s3-editor.md with a recommendation.

B. S4 chat list spike (1 agent, critical path). A bottom-anchored virtualized message list: a Mount with ResizeObserver measuring rows, prepend anchoring and stick-to-bottom in update. Add a `heavy` dataset (10k messages, 500 channels) to ui-parity. Exit criteria: `chat-channel` variants identical; 60fps scrolling on the heavy dataset (measure with Playwright tracing); position kept when older messages prepend. Also benchmark the TanStack DB bridge (liveQueryStream) vs a normalized Model store on the heavy dataset, which closes S2. Deliverable: docs/foldkit-decisions/s4-chat-list.md (plus s2-data.md).

C. Scenario coverage (3–4 agents in parallel, split by area: settings and integrations / my-settings, notifications and profile / chat states and overlays / onboarding, auth and join). Grow `bun run parity coverage` from 10/39 to 39/39, and add datasets: empty, member (non-admin), onboarding, rich (threads, embeds, attachments, pins, custom emojis, bots, integrations), errors. Add canned RPCs to packages/ui-parity/src/backend/rpc.ts as needed. Exit criteria: each new scenario passes `bun run parity selfcheck` (deterministic, no console errors). These agents only touch packages/ui-parity. To avoid conflicts, scenarios go in per-area files (src/scenarios/<area>.ts) aggregated by scenarios.ts; do that split yourself before launching them.

D. Phase 1 UI kit (start after Step 0, 2–3 agents in parallel by primitive group: buttons, fields and forms / overlays: menu, popover, dialog, modal, sheet, tooltip / data display: table, tabs, list-box, toggle, badge, avatar, separator). For each primitive:
   1. Extract its tv()/twMerge styles from apps/web/src/components/ui/<x>.tsx into <x>.styles.ts (neutral, verified by legacy-ui-guard).
   2. Port it to apps/web-foldkit/src/ui/<x>.ts on top of @foldkit/ui where it fits. Reproduce React Aria data attributes and the `[data-react-aria-pressable]` behavior. Map RAC variants with @custom-variant as described in plan §3.3.
   3. Add a gallery scenario.
   Gallery: you (the orchestrator) first add one dev route `/_dev/gallery/$component` to BOTH apps rendering every state of a primitive (open, hover, focus-visible, disabled, invalid), then re-pin the legacy baseline to that commit in a dedicated "re-pin" commit with legacy-ui-guard confirming every existing scenario is unchanged. Exit criteria: gallery scenarios identical in light and dark.

E. After A, B and D land: Phase 2 shell (channels sidebar, nav badges, mobile nav and sheet, command palette, modals system, toasts), then Phase 3/4 chat, then Phase 5 screens (one agent per area, in parallel). Use the per-screen loop in packages/ui-parity/README.md.

## Integration (your job)
- Hot files where only you merge: apps/web-foldkit/src/main.ts, route.ts, shell/app-shell.ts, packages/ui-parity/src/scenarios.ts, plus the gallery routes. Subagents deliver self-contained modules (page/<area>/<page>/*, ui/<x>.ts, scenarios/<area>.ts) and describe the wiring they need. You apply it.
- After merging each subagent's work: typecheck all three packages (apps/web, apps/web-foldkit, packages/ui-parity), `bun run parity build foldkit`, run parity for the affected areas, run legacy-ui-guard if legacy changed, then commit.
- Keep docs/foldkit-migration.md current: mark spikes ✅ with links, update coverage numbers, add new gotchas to the S1 record's table or a new decision record.
- If a subagent's result fails verification, send it back (continue the same agent with SendMessage) with the summary.md excerpt. Don't fix it silently yourself.

## Stop and ask the user
- If S3 or S4 fails badly (plan §4 says to reconsider the migration).
- Before any destructive git operation, a force push, or changing the pinned baseline outside the gallery re-pin.
- If Foldkit itself needs patching (decision: keep missing pieces local in apps/web-foldkit/src/ui, no upstream PRs yet).

## Report back
At each milestone, give a short status: what landed (commits), parity totals per area, coverage x/39, open risks, and the next batch you're launching.
````
