# Hazel UI gaps

What the phase 1 screens (`apps/shared-screens/src/{chat,composer,channel-sidebar,settings}`) needed
and the C1 vocabulary did not say. The user resolved the whole ledger on 2026-11-26 (phase 1.5): every
proposed resolution was accepted, except `empty-illustration`, which became the `emptyState`
primitive. Each resolution is in the contracts below; the screens use the new API and carry no
`HAZEL-GAP` markers. A primitive's renderers and fixtures land with its lane (`LANES.md`).

New gaps: a lane that needs an option that does not exist uses the nearest one, marks the call
`// HAZEL-GAP(<id>): <need>` and adds a row under "Open". The user resolves them.

Kinds: **option** (a value in a closed set), **prop** (a prop, flag or event on an existing tag),
**primitive** (a new tag), **composite** (a governed `h.custom`), **service** (a platform service, not
vocabulary), **renderer** (decided inside the primitive, no API change).

## Resolved

| Id                     | Screen             | Need                                                                 | Resolution (where it landed)                                                                                                       | Kind      |
| ---------------------- | ------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `message-provider`     | message            | Slack or Discord mark after a synced author's name                   | `row.provider: "slack" \| "discord"` (`content.ts` `MessageRow`, `options.ts` `Provider`); icons `slack`, `discord`                | prop      |
| `reaction-who`         | message            | tooltip naming who reacted                                           | `Reaction` is a struct with `who: {names, others}` (`content.ts`)                                                                  | prop      |
| `quick-reactions`      | message            | three quick emoji in the hover toolbar                               | `row.quick: string[]`; a press raises `pressReaction`                                                                              | prop      |
| `message-action-issue` | message            | "Create issue" in More                                               | `issue` in `MessageAction` (`options.ts`)                                                                                          | option    |
| `anchor-in-leaf`       | message            | profile popover anchored at a mention inside the row                 | `popover.anchorTo({key, run})` (`content.ts` `LeafAnchor`); `pressMention` carries `run`                                           | prop      |
| `list-overlay-bar`     | message list       | "N new messages" bar floating over the list's top                    | `list` slot `overlay` (`spec.ts`)                                                                                                  | prop      |
| `skeleton`             | message list       | skeleton rows while loading                                          | `list.loading` flag; the skeleton is renderer-owned (A4, S5)                                                                       | renderer  |
| `empty-illustration`   | message list       | the empty state's illustration                                       | new primitive `emptyState` (title, description, `icon`, `illustration` from `emptyIllustrations`, slot `action`); owned by A1 / S1 | primitive |
| `autocomplete-keys`    | composer           | arrows, Enter, Tab, Escape drive suggestions while a trigger is open | `composer` event `key {key: ComposerKey}`                                                                                          | prop      |
| `file-picker`          | composer, settings | pick files and upload them natively                                  | `Files.pick` (`packages/client-data/src/platform/ui-services.ts`), interface only; lane F implements                               | service   |
| `file-drop`            | composer           | drop or paste files                                                  | `composer` event `files {count}`; the files are taken with `Files.dropped`                                                         | prop      |
| `emoji-gif-picker`     | composer           | emoji and GIF picker dialogs                                         | `emojiPicker` primitive (A3 / S3); GIF is the web-only extension `GifPicker` (`src/extensions/GifPicker.ts`, A3 registers it)      | primitive |
| `avatar-provider-mark` | composer           | presence dot or provider mark on a mention's avatar                  | `avatar.presence` covers presence; `avatar.mark` (`providerMarks`)                                                                 | prop      |
| `field-required`       | composer           | required marker on bot command fields                                | `textField.required` flag                                                                                                          | prop      |
| `thread-elbow`         | sidebar            | thread rows hang off their channel with an elbow                     | `item.nested` (`itemNestings`: `none`, `middle`, `last`)                                                                           | prop      |
| `item-muted`           | sidebar            | muted channel and discover rows are dimmed                           | `item.muted` flag (still pressable)                                                                                                | prop      |
| `section-action-menu`  | sidebar            | a section's "+" opens a menu                                         | `section.action` stays one action and also takes `Hazel.actionMenu(entries, select)`; `hz:action` gains `entries` and `select`     | prop      |
| `kbd-hint`             | sidebar            | keyboard shortcut at a row's end                                     | `item.shortcut: string` (web only; iOS ignores it)                                                                                 | prop      |
| `menu-submenu`         | sidebar            | "Notifications", "Move to section" submenus                          | `MenuEntry.entries` of `MenuLeaf` (one level), maps to `UIMenu` children                                                           | prop      |
| `drag-reorder`         | sidebar            | reorder channels and sections by drag                                | `reorderable` flag and `move {id, before}` event on `list` and `section`                                                           | prop      |
| `avatar-large`         | settings           | large logo avatar that is the upload button                          | `avatar.size` (`avatarSizes`: `regular`, `large`) and `avatar` event `press`                                                       | option    |
| `field-monospace`      | settings           | the workspace URL reads as code                                      | `textField.monospace` flag                                                                                                         | prop      |
| `clipboard`            | settings           | copy the workspace URL                                               | `Clipboard.write` (`ui-services.ts`), interface only; lane F implements                                                            | service   |
| `progress`             | settings           | export progress bar                                                  | `progress` primitive (`value` 0 to 1, `indeterminate`, `label`); owned by A1 / S1                                                  | primitive |
| `frame-danger`         | settings           | danger zone card with a tinted header                                | `frame.surface` value `danger`                                                                                                     | option    |

The message row also lost G7's short keys (decision 4): `row` uses readable keys only, and grouping is
the message's `grouped` flag. This was a contract decision, not a gap.

## Open

| Id | Screen | Need | Proposal | Kind |
| --- | --- | --- | --- | --- |
| `semibold-weight` | message, settings | kit headings, dialog titles and the message author are `font-semibold` (600); `font.weight` has `regular` and `strong` (500) only | a third weight in `Tokens.font.weight` and a recipe `weight` step (`schema.ts`); until then recipes use `strong` (lane D, `RECIPES-REVIEW.md`) | option |
| Id                  | Screen or lane  | Need                                                     | Stand-in (where)                                                     | Kind     |
| ------------------- | --------------- | -------------------------------------------------------- | -------------------------------------------------------------------- | -------- |
| `recipe-align-end`  | A1 `stack`      | a recipe `align: "end"` (`stack.align` has the value)    | the web renderer sets `align-items: flex-end` (`layout/stack.ts`)    | renderer |
| `recipe-overflow`   | A1 `scroll`     | a recipe declaration for overflow (scroll along an axis) | the web renderer sets `overflow-x`/`overflow-y` (`layout/scroll.ts`) | renderer |
| `recipe-text-align` | A1 `emptyState` | a recipe declaration for centred text                    | the web renderer sets `text-align: center` (`content/emptyState.ts`) | renderer |
| Id                | Lane | Need                                                                                                                                                                                    | Meanwhile (where)                                                                                                                                          | Kind     |
| ----------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `leaf-anchor-key` | A3   | `popover.anchorTo({key, run})` needs the leaf keyed `key` in the DOM, but the web host never sees view keys; the leaves that draw runs (`message` A5, `richText` A1) must mark each run | A leaf may set `data-hz-key`; else the run pressed last with that index is the anchor. Leaves mark runs `data-hz-run=<index>` (`src/web/focus/anchors.ts`) | renderer |
| `overlay-tokens`  | A3   | a scrim colour and an overlay shadow token (menus, popovers, dialogs float with `shadow.xs`)                                                                                            | the scrim mixes 32% `fg` into transparent (`src/web/focus/surface.ts`); recipes use `shadow: "xs"`                                                         | token    |
