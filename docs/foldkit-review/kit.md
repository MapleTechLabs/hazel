# Foldkit review: UI kit (`apps/web-foldkit/src/ui/`, `ui/aria/`, `src/gallery/`)

Reviewed 2026-10-08 on `fk/review-kit` (base `experiment-2.0` 7d7b2e69f) against Foldkit 0.167.0 and the
docs at https://foldkit.dev (architecture, testing, story, scene, commands). Background:
`docs/foldkit-decisions/s5-primitives.md`.

Doc rules referenced below:

- [Architecture](https://foldkit.dev/core/architecture): one Model, only `update` changes it; `update`
  and `view` are pure; side effects live in Commands, Mounts, Subscriptions, ManagedResources.
- [Commands](https://foldkit.dev/core/commands): verb-first names, one declared result Message,
  `generation` counters for stale results, interruptible names unique app-wide.
- [Subscriptions](https://foldkit.dev/core/architecture): a scoped Stream gated by a Model slice.
- [Submodels / OutMessages](https://foldkit.dev/core/architecture): the child surfaces facts through
  `outMessage`; parent-computed values go in ViewInputs.
- [Testing](https://foldkit.dev/testing): Story for the state machine, Scene for interactions and
  rendered output; locate by role, label and text.

## What is already good

- **Message and Command naming is clean.** Every Message tag in the kit is a past-tense fact
  (`PressedNavigationKey`, `ClickedOption`, `CompletedFocusTab`, `MeasuredToast`); no `NoOp`, no
  imperatives. Every Command and Mount is `Command.define`/`Mount.define(Stream)` with a verb-first name.
- **Effects are where they belong, almost everywhere.** Focus moves are Commands (`Dom.focus` in tabs,
  list box, select, menu, combo box, slider) or `h.OnKeyDownFocus`, the Foldkit primitive for focusing
  inside keydown. Portals, positioning, inert siblings, scroll lock and focus containment run in Mounts
  that pair setup with `Effect.acquireRelease` cleanup (`modal.ts:69`, `popover.ts:57`, `menu-view.ts:59`).
- **Stale timers use the documented generation pattern** (`tooltip.ts:27` `version`, toast `version`,
  typeahead reset comparing `search`), which is exactly what the Commands page recommends.
- **Gated Subscriptions where it matters**: the slider drag stream (`slider.ts:164`) only exists while
  `dragging !== null`, so pointermove is not observed at rest.
- **Models are Schema-typed** with tagged unions for state (`combo-box.ts:20` `Popup`, `table.ts:26`
  `Focus`), `Option` instead of nullables in most new code, and `Match`/`Message.match` instead of switch.
- **The vendored React Aria math** (`aria/position.ts`, `aria/scroll.ts`) is isolated behind Mount-only
  helpers, which is what made the S5 pixel parity possible.

## Top findings: real bugs exposed by the new tests

Each is pinned by a `test.fails` with a one-line comment naming the bug; flipping it to `test` is the
acceptance check for the fix. Source was not changed.

| # | Bug | Where | Test |
| --- | --- | --- | --- |
| T1 | Typing a complete date into the picker's segments never emits `OutMessage.ChangedValue`; only the calendar path does. `set-status.ts:93` works around it by reading `customDate` out of the child Model. | `ui/date-picker.ts:138-145` (`GotSegmentsMessage`) | `date-picker.story.test.ts:168` |
| T2 | A disabled row in a multiple-selection choice box can still be selected through its checkbox: the row checkbox gets no `isDisabled`. | `ui/choice-box.ts:244-257` | `choice-box.scene.test.ts:129` |
| T3 | `isReadOnly` only drops the row click; the grid keydown still toggles the focused row with Space/Enter. | `ui/choice-box.ts:298` vs `:332` | `choice-box.scene.test.ts:106` |
| T4 | Space during an active typeahead activates the focused menu item instead of extending the search (select guards this, menu does not). | `ui/menu.ts:386` (vs `select.ts:216`) | `menu.story.test.ts:254` |
| T5 | ArrowRight/ArrowDown on the last option of a closed Select falls back to the current key and still emits `ChangedSelection` for an unchanged value. | `ui/select.ts:106` | `select.story.test.ts:104` |
| T6 | A Select with only an `aria-label` labels its popover and listbox with `aria-labelledby` pointing at a label element that is not rendered. | `ui/select-view.ts:323`, `:378` | `select.scene.test.ts:142` |
| T7 | The day segment's limit is always 31, so ArrowDown below the 1st of February shows 31 while the committed value is the 28th. | `ui/date-segments.ts:134` (`segmentLimits`) | `date-segments.story.test.ts:50` |
| T8 | `ClickedPrevious` does not clamp the focused date to `minValue`, so paging into the minimum month leaves no focusable cell. | `ui/calendar.ts:371` | `calendar.story.test.ts:136` |
| T9 | A decimal `step` snaps with float arithmetic and is never rounded to the step's precision (0.1 steps land on 0.30000000000000004). | `ui/slider.ts` (`setThumbValue`) | `slider.story.test.ts:91` |

All nine are "fix now, low risk": each is a local change in one `update` or view function.

<!-- BUGS -->

## Bug risk

### B1. `update` reads the host platform (`isAppleDevice()`), so Commands depend on the machine

- `ui/combo-box.ts:226`, `:234`, `:238`, `:256` call `isAppleDevice()` (`aria/announcer.ts:129`, reads
  `navigator.userAgentData` / `navigator.platform`) inside `update` to decide which `AnnounceComboBox`
  Commands to return.
- Rule: `update` is pure ([architecture](https://foldkit.dev/core/architecture)).
- Why it matters: the same Model and Message produce different Commands on macOS and Linux, so a Story
  test passes on one host and fails on another (jsdom reports an empty platform, so tests only ever
  cover the non-Apple branch), and DevTools replay is not deterministic.
- Fix (low risk): read the platform once at startup (a Flag or `Shared`) and store `isAppleDevice` in
  the ComboBox Model via `init`, or move the Apple-only branch into the `AnnounceComboBox` Command
  (pass all candidate texts, let the Command filter).

### B2. `DatePicker.update` reads the clock through `Segments.init`

- `ui/date-picker.ts:158` calls `Segments.init(...)` inside `update`; `ui/date-segments.ts:64` does
  `new Date()` to build the placeholder ("today"). `Segments.init` also runs inside other `init`s.
- Rule: `update` is pure; no `Date.now` in update ([architecture](https://foldkit.dev/core/architecture)).
- Why it matters: the placeholder segment values (and therefore what ArrowUp on an empty segment
  commits) change at midnight and differ between test runs; Story tests cannot pin them.
- Fix (low risk): add a `today: CalendarDate` (or `nowMs`) parameter to `Segments.init` and pass
  `Shared.nowMs`-derived dates from the caller, the way `calendar-date.ts:17` `today(now)` already
  takes `now`.

### B3. Table and tree key handlers read `document.activeElement` in the view

- `ui/table-view.ts:95` (`tableNavigation`), `ui/table-view.ts:316` (row `OnKeyDownFocus`) and
  `ui/tree-view.ts:203` decide whether to handle a key by reading `document.activeElement` when the
  handler runs.
- Rule: `view` is pure and its handlers construct Messages ([architecture](https://foldkit.dev/core/architecture)).
- Why it matters: the decision is invisible to the Model, so Scene tests (no live focus) always see
  `Option.none()` and these keyboard paths cannot be tested; it also couples correctness to render
  timing (a row that rendered before focus moved answers with stale closures).
- Fix (low risk): the Model already tracks focus (`table.ts:26` `Focus` union, tree `maybeFocusedKey`).
  Branch on `model.focus._tag` in the view instead of the DOM, or add a `FocusedTable` variant to
  `Focus` (the `FocusedTable` Message exists already, `table.ts:76`).

### B4. Module-level overlay state is shared across every overlay and never reset

- `ui/aria/overlay.ts:114` `overlayStack`, `:126` `inertCounts`, `:152-153` `scrollLocks` /
  `restoreScroll`.
- Rule: no module-level mutable state; stateful handles belong to a Model slice (ManagedResource) or a
  Mount's own scope ([architecture](https://foldkit.dev/core/architecture)).
- Why it matters: `restoreScroll` captures `document.documentElement.style` of the *first* lock; if a
  Mount's release is skipped (an exception in setup after `preventScroll()`, or HMR replacing the
  module while an overlay is open), `scrollLocks` never returns to 0 and the page stays
  `overflow: hidden` for the rest of the session with no way to recover. `portalOverlay` and
  `watchInteractOutside` each push a token, so one modal popover holds two stack entries; correctness
  depends on release order.
- Fix (needs a design change): own the overlay stack in one place, either a root `Overlays` Model
  slice whose Mounts report `Opened/Closed` facts, or a single app Resource (`OverlayManager`) acquired
  once with an explicit release. At minimum (low risk) make `preventScroll` idempotent per token and
  compute the restore values on the 0 to 1 transition only from a stored snapshot keyed by token.

### B5. Global modality listeners and pending-button announcements install themselves forever

- `ui/aria/interaction.ts:249-265` `globalModality` / `trackGlobalModality` (called from the tooltip
  Mount, `ui/tooltip.ts:155`) adds four capture listeners on `document` that are never removed.
- `ui/aria/pending-announcement.ts:8-58` runs at import (`toast-view.ts:16` imports it for its side
  effect): module `let` state, two document listeners and a whole-document `MutationObserver`.
- `ui/toast.ts:15-18` injects the sonner stylesheet into `<head>` at import.
- Rule: no module-level state; DOM work in Mounts with cleanup, or Resources for app-lifetime handles
  ([architecture](https://foldkit.dev/core/architecture)).
- Why it matters: importing `ui/toast.ts` in a non-DOM environment throws (`document` is undefined), so
  every test that touches the toaster must run under jsdom; the module state also leaks between tests
  in one file. Three different modality sources now coexist (`interaction.Model.modality`,
  `collection.Interaction.modality` per component, `globalModality`), and they disagree: a tooltip
  can show as focus-visible while the page's interaction Submodel says pointer.
- Fix (needs a design change): make modality one app-level fact. The interaction Submodel already
  tracks it; the root can pass `modality` to components as a ViewInput, and the tooltip Mount can take
  it from the Message that hovers it (`HoveredTrigger` already carries `isPointerModality`, computed
  by the parent instead of a global). Move the sonner stylesheet into a Command like
  `InstallInputOtpStyle` (`input-otp.ts:54`) does, and the pending-button observer into a Mount on
  the toaster root.

## Architecture violations

### A1. Submodel API is inconsistent across components

| Concern | Variants in the kit |
| --- | --- |
| `init` | config object (`tabs.ts:29`, `select.ts:43`, most) vs positional id (`modal.ts:27`, `popover.ts:24`, `tooltip.ts:35` plus `initWithDelay`) vs `label` as identity (`toolbar.ts:24`, `toggle-group.ts:29`) |
| Value changes surfaced as OutMessage | yes: combo box, select, menu, list box, calendar, date picker, command menu, toast. No: tabs, toggle group, tree, table, choice box, slider, input OTP, date segments, modal, popover, tooltip |
| Collection data | in the Model (select, combo box, menu with `reflectEntries`, list box) vs ViewInputs with keys copied into Messages (`tabs.ts:49` `PressedNavigationKey { keys, disabledKeys }`, table `rowText`) |
| Parent control | Messages only (most) vs exported `open`/`close` helpers returning `Update.Return` (`modal.ts:57-61`, `command-menu.ts`), whose `commands` callers drop (`page/settings/general/update.ts:252` uses `Modal.open(modal).model`) |
| View location | `<name>-view.ts` (select, menu, combo box, list box, table, tree, calendar, date picker, command menu, toast) vs same file (tabs, modal, popover, tooltip, toolbar, toggle group) |

- Rule: the child surfaces facts to the parent through `outMessage`; parent-computed values go in
  ViewInputs ([architecture](https://foldkit.dev/core/architecture), Submodels / OutMessages).
- Why it matters: without an OutMessage the parent must read `child.selectedKey` / `child.isOpen`
  after every fold to notice a change (and cannot tell user-dismissed from parent-closed);
  `Modal.open(...).model` silently drops Commands the day `open` starts returning any.
- Fix: (low risk, additive) add `ChangedSelection` / `ChangedValue` / `Closed` OutMessages to tabs,
  toggle group, tree, table, choice box, slider, OTP, modal and popover; make `open`/`close` return a
  Model (or route through Messages). (design change) Pick one collection-data strategy; the
  ViewInputs-plus-keys-in-Message approach avoids `reflectEntries` resync and is the documented
  ViewInputs pattern. Key toolbar and toggle group by `id`, not by `aria-label` (`toolbar.ts:51`
  queries `[role="toolbar"][aria-label=...]`, so two toolbars with one label collide).

### A2. Always-on Subscriptions that do gated work or fire on every document event

- `ui/input-otp.ts:281-300`: `selectionchange` on `document` is subscribed whenever an OTP exists and
  dispatches `ChangedSelection` for every selection change anywhere on the page, although the Model
  has `isFocused` (`input-otp.ts:26`).
- `ui/toast.ts:424-436`: the `keydown` entry is persistent and gates on `isInsideToaster()` (a DOM read)
  at event time.
- `ui/aria/interaction.ts:199-241` and `ui/list-box.ts:323`: persistent document listeners dispatch a
  Message on every keydown, keyup, pointerdown and pointerup. The comment justifies it (restarting
  per press costs a fiber), and that is fine for `pointerRelease`, but each embedded instance (page
  plus modal, e.g. `overlay/modal/install-bot-by-id.ts`) multiplies root re-renders per keystroke.
- Rule: a Subscription is gated by a Model slice and restarts when it changes
  ([architecture](https://foldkit.dev/core/architecture)).
- Fix (low risk): gate the OTP stream on `isFocused`; gate the toast keydown entry on
  `toasts.length > 0`. (design change) one interaction instance per app (root) instead of per page.

### A3. Tooltip trigger events bypass the view

- `ui/tooltip.ts:142-198` attaches `pointerenter`/`pointerleave`/`focus`/`blur`/`pointerdown`/`keydown`
  listeners imperatively in the `TrackTooltipTrigger` Mount instead of `h.On*` handlers, to read the
  global modality synchronously.
- Rule: view handlers construct Messages; Mounts are for imperative work that has no declarative form
  ([architecture](https://foldkit.dev/core/architecture)).
- Why it matters: Scene cannot hover or focus a tooltip trigger; tests must emit Mount stream
  Messages by hand. It is also the only consumer of the global modality (B5).
- Fix (design change, together with B5): render the handlers on the trigger via the existing
  `toTrigger(attributes, overlay)` ViewInput and pass the parent's interaction modality in.

### A4. Locale read from `navigator` in `view` and `update`, and two locales for one picker

- `ui/date-field.ts:38`, `:51-52` (`navigator.language`, new `Intl.DisplayNames` /
  `Intl.DateTimeFormat` per segment per render) and `ui/date-segments.ts:95` (`locale()`, used by
  `segmentsOf` from `update` at `:348` and `:385`).
- Calendar formatting is pinned to en-US (`calendar-date.ts:1-4`), date segments follow the browser.
- Rule: `update`/`view` are pure ([architecture](https://foldkit.dev/core/architecture)).
- Why it matters: backspace and typing behavior in `update` depends on the host locale (segment text
  differs per locale), so Story results differ per machine. (The en-US calendar next to localized
  segments mirrors legacy, so it is parity, not a regression.)
- Fix (low risk): put `locale` in the Segments Model (set by `init` from a Flag or `Shared`) and cache
  the formatters per locale at module scope (a pure memo) instead of constructing them per render.

## Convention

- **C1. Inline `as` casts.** `ui/popover.ts:66`, `ui/menu-view.ts:75`, `ui/tooltip.ts:215`
  (`placement as Placement`: the Mount args declare `placement: Schema.String`); `ui/date-segments.ts:183`,
  `:427` (`as SegmentType`); `ui/aria/overlay.ts:44`, `:153`, `:254`; `ui/aria/announcer.ts:131`.
  Fix (low risk): export a `Placement` `Schema.Literals` from `aria/position.ts` and use it in the Mount
  args; decode Intl part types with `Schema.is(SegmentType)`; `tabbables.findIndex((el) => el === document.activeElement)`.
- **C2. Command and Mount definitions are not exported.** Tests need the Definition to
  `Command.resolve`; only seven of 49 were exported (`FocusSegment`, `AnnounceSegmentValue`,
  `PortalModal`, `PortalDatePicker`, `MeasureToast`, `FocusCalendarCellOnPress`, `FocusTriggerOnPress`). This
  branch exports the ones the new tests resolve (purely additive). Export every Definition by default,
  as the Scene docs say UI components should.
- **C3. Generic Command names.** `FocusItem` (`choice-box.ts:69`), `FocusElement` (`menu.ts:249`),
  `FocusRow` (`tree.ts:55`) read ambiguously in DevTools and traces next to `FocusListBoxItem`,
  `FocusSelectElement`. Prefix with the component as the others do.
- **C4. Focus via raw DOM inside Commands.** `date-segments.ts:234`, `table.ts:106`, `tree.ts:65`,
  `toolbar.ts:51-60` use `document.getElementById(...).focus()` in `Effect.sync`, the rest use
  `Dom.focus`. `slider.ts:105` builds `#${inputId}` without `CSS.escape` (every other site escapes).
- **C5. `embedInteraction` is copied three times**: `gallery/interaction.ts`,
  `page/settings/integrations/shared/interaction.ts`, `page/my-settings/shared.ts:43`. Export one
  generic version from `ui/aria/interaction.ts` (parameterized over the Subscription input `read`).
- **C6. Two `Modality` schemas** with different literals: `aria/interaction.ts:18`
  (`keyboard|pointer|virtual`) and `aria/collection.ts:14` (`Unknown|Keyboard|Pointer`), plus
  `combo-box.ts:18` and `select.ts`/`menu.ts` local ones. See B5.

## Fix now (low risk) vs design change

- **Fix now:** T1 to T9; B1 (platform flag in the Model), B2 (pass `today` into `Segments.init`), B3
  (branch on the Model's focus, not `document.activeElement`); A1's additive OutMessages and making
  `open`/`close` return a Model; A2 gating of the OTP and toast streams; A4 locale in the Model; C1 to C5.
- **Needs a design change:** B4 (one owner for the overlay stack and scroll lock), B5 and A3 (one
  app-level modality fact, tooltip handlers in the view), A1's single collection-data strategy, A2's
  one interaction instance per app.

## Tests added on this branch

49 kit test files, 453 new tests (plus the 3 existing `date-segments.test.ts` tests), all green;
9 of them are `test.fails` pinning T1 to T9. `bunx tsc --noEmit` is clean.

- Story (`*.story.test.ts`, 21 files): tabs, menu, select, combo box, list box, choice box, toggle
  group, toolbar, tree, table, modal, popover, tooltip, command menu, toast, calendar, date picker,
  date segments, slider, input OTP, and `aria/interaction` (modality, press, hover, focus-visible,
  `disabledTargets`).
- Scene (`*.scene.test.ts`, 26 files): the same Submodels through their views, plus sheet, date
  field, and the stateless controls button, checkbox, radio, switch, toggle (through a small harness).
  Locators are role, label and text; assertions cover `aria-selected`, `aria-checked`,
  `aria-expanded`, `aria-disabled`, `aria-activedescendant`, `aria-sort`, `aria-valuenow`, dialog
  `aria-modal`/`aria-labelledby`.
- Plain unit test: `aria/collection.test.ts` (`moveKey`, `directionOfKey`, `itemState`).
- Helpers: `src/test/kit-forms-fixtures.ts` (a tiny parent holding the interaction Model, for the
  stateless controls) and `src/test/kit-collections-fixtures.ts` (`installCssEscape`).
- Source changes are purely additive `export` keywords on 31 Command and Mount Definitions so tests
  can resolve them (C2).

Testing notes for the next person:

- Scene files need `// @vitest-environment jsdom`: Scene builds DOM targets for pointer events, and
  `ui/toast.ts` touches `document` at import (B5).
- jsdom has no `CSS.escape`, which collection views call inside keydown handlers; call
  `installCssEscape()` first.
- `h.Tabindex` is a numeric prop that `toHaveAttr` cannot read, so roving tabindex is asserted via
  the Model in Story tests instead.
- The table-level and tree-level keydown paths that read `document.activeElement` (B3) and the tooltip trigger
  events (A3) cannot be driven from Scene; tooltip scenes emit the trigger Messages with `Subscription.emit`.
- Combo box announcement tests only cover the non-Apple branch (B1).

