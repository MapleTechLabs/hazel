# S5: Primitive parity

Status: **passed** · 2026-10-07 · Branches `fk/kit-forms`, `fk/kit-overlays`, `fk/kit-data` (merged)

Question: do `@foldkit/ui` plus the shared stylesheet reach pixel identity with the React Aria primitives, in both themes, including interaction states?

## Result

Every primitive renders on `/dev/gallery/<name>` in both apps (static states in the entry, interactive states from scenario steps). Foldkit against the working-tree legacy app, all four gallery areas together:

| Group | Primitives | Identical | Pass (sub-perceptual) | Fail |
| ----- | ---------- | --------- | --------------------- | ---- |
| Buttons, fields, forms | 17 | 120 | 6 | 0 |
| Overlays | 12 | 142 | 18 | 0 |
| Data display | 12 | 62 (incl. Button) | 2 | 0 |
| **All galleries** | **41** | **315** | **23** | **0** |

The S5 exit set: Button, Menu (open), Dialog, Tooltip, Select and Tabs are all identical in light and dark. Every pass is 6 to 39 strict pixels at ±1 per channel on anti-aliased corners (refocused triggers, buttons under a backdrop, rounded OTP slots), with identical DOM and computed styles.

## What made it work

- **Same stylesheet, same attributes.** The Foldkit app imports the legacy stylesheet verbatim, including `@plugin 'tailwindcss-react-aria-components'`. Instead of mapping RAC variants onto Foldkit attributes with `@custom-variant` (the plan's §3.3 idea), the ports emit React Aria's own DOM: `data-rac`, `data-hovered`, `data-pressed`, `data-focus-visible`, `data-selected`, `data-open`, `data-placement`, `data-slot`, roles and aria-*. The CSS output is byte-identical and no Foldkit-only CSS was needed.
- **Same class composition.** Every `tv()`/`twMerge` definition moved into `components/ui/<x>.styles.ts`, imported by both apps. 40+ extractions, each proven neutral by legacy-vs-legacy parity.
- **React Aria behavior, emulated in three shared helpers** (`apps/web-foldkit/src/ui/aria/`):
  - `interaction.ts`: hover, press (pointer and keyboard, pressed-inside tracking, `user-select` while pressed) and focus-visible with React Aria's global modality rules.
  - `overlay.ts`, `position.ts`, `announcer.ts`: React Aria's `calculatePosition`, vendored (Apache-2.0), driven with the same inputs (container padding 12, offset 8/10/12). Placement, flip and arrow offsets landed on the same pixel with no tuning. Portals at the end of `<body>`, underlay, inert siblings, scroll lock, focus containment and restoration.
  - `collection.ts`: roving focus, orientation-aware arrow keys that skip disabled items, selection modes, typeahead, focus moved inside keydown (so fast keystrokes land on the new item).

## `@foldkit/ui` limits hit

None of its overlay or collection components could produce React Aria's DOM, so the kit is built on `h` plus Mounts and Commands, kept local per decision §8:

- Menu/Listbox items only take a className and string content: no state attributes, no submenus, no context menus.
- Anchor uses floating-ui with different math and writes its own inline styles and portal root.
- Dialog uses `<dialog>` and the top layer; Tabs renders without hover or focus state.
- 0.166 has no `Update.foldChildAt`; galleries fold children by id with `foldChild`.

## Gotchas

| Gotcha | Fix |
| --- | --- |
| Foldkit renders on animation frames, so a second fast keystroke reached the old item | Resolve the next item in `update` and move focus inside the keydown handling |
| Native `:hover` vs React Aria's `data-hovered` (touch semantics) | Button without interaction wiring omits `data-rac`, so native `:hover` applies (kept S1's team page unchanged) |
| The spin loader's SVG animation ignored the CSS animation freeze | The harness pauses SVG animations at t=0 |
| Three agents extracted the same field/input/keyboard styles under different names | Merged to one set of names; extraction ownership per file is now explicit |

## Left for follow-up

- ListBox, Calendar and RangeCalendar (depended on the dropdown styles and Select, now merged); table checkbox selection; a standalone Dropdown gallery; Toast (Phase 2).
- Wire Menu/Select triggers and the tooltip's local modality tracker into `interaction.ts`, which also removes the refocus corner noise.
- Behavior gaps with no pixel effect yet: one submenu level, tooltip warm-up across siblings, combo box custom values, enter/exit animations not emitted, slider grab offset.
