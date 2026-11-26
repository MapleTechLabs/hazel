# Hazel UI motion

The motion layer of the contract: what moves in today's app (the source of truth), the named motions
the style layer keeps for it (`src/style/tokens.ts` `keyframes` and `motion`), which primitive plays
which (`motion` in `src/style/recipes/<tag>.ts`), and how Reduce Motion behaves. Codegen writes the web
CSS (`tokens.css`: `@keyframes`, the `[data-motion]` rules, the reduced-motion rule) and the Swift
theme (`HazelTheme.Motion`: keyframes, durations, curves, per-primitive uses).

## Today's motion (audit, 2026-11-26)

Sources: `apps/web-foldkit/src/core/styles/styles.css` (`--animate-*`, `@keyframes`, the reduced-motion
rule), `core/components/ui/*.styles.ts`, `src/ui/*.ts`, the sidebar, rail and notification code.
Tailwind v4 in this app: `ease-out` is `cubic-bezier(0.23, 1, 0.32, 1)` and `ease-in-out`
`cubic-bezier(0.77, 0, 0.175, 1)` (overridden in `@theme`); `ease-in` is Tailwind's
`cubic-bezier(0.4, 0, 1, 1)`; a class with no `ease-*` uses Tailwind's default
`cubic-bezier(0.4, 0, 0.2, 1)` and, with no `duration-*`, 150ms. "Enter" below is CSS
`@starting-style` (`starting:`) unless it says keyframes.

### Overlays

| Where                           | What moves                                     | How                                 | Duration            | Easing            | Exit                                   |
| ------------------------------- | ---------------------------------------------- | ----------------------------------- | ------------------- | ----------------- | -------------------------------------- |
| Menu, select, combo, popover    | panel opacity 0 to 1                           | `popover.styles.ts` transition      | 150ms               | ease-out          | none (removed at once)                 |
| Context menu on a phone (sheet) | scrim opacity; panel opacity and 16px rise     | `menu-view.ts` `PHONE_SHEET_*`      | 200ms               | ease-out          | none                                   |
| Emoji picker                    | panel opacity (a popover)                      | `popover.styles.ts`                 | 150ms               | ease-out          | none                                   |
| Tooltip                         | opacity, 4px slide from the trigger's side     | `tooltip.styles.ts`                 | 150ms               | ease-out          | none                                   |
| Dialog (modal), command menu    | backdrop opacity; panel opacity and 16px rise  | `modal.styles.ts`, `command-menu`   | 200ms               | ease-out          | none                                   |
| Dialog at `sm` and up           | panel opacity and scale 0.97 to 1 (no rise)    | same                                | 200ms               | ease-out          | none                                   |
| Sheet (side panel)              | backdrop opacity; panel opacity and 100% slide | `sheet.styles.ts`                   | 200ms               | ease-out          | none                                   |
| Toast                           | opacity and 8px rise (8px drop from the top)   | `toast.styles.ts` + kit `Animation` | 200ms in, 150ms out | ease-out, ease-in | opacity and 8px drop; stays until done |

### Content, chat and fields

| Where                       | What moves                                                                           | Keyframes / transition                 | Duration            | Easing                              | Notes                                |
| --------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------- | ------------------- | ----------------------------------- | ------------------------------------ |
| Message arriving live       | opacity, 6px rise                                                                    | `message-enter`                        | 180ms               | `cubic-bezier(0.2, 0, 0, 1)`        | only `isEntering` rows               |
| Reaction pill appearing     | opacity, scale 0.6 to 1                                                              | `reaction-enter`                       | 220ms               | `cubic-bezier(0.34, 1.56, 0.64, 1)` | slight overshoot                     |
| Reaction count up           | the emoji pops to 1.3 at 45%                                                         | `reaction-pop`                         | 260ms               | same overshoot                      | only on a rise                       |
| Reaction count change       | the number rolls in from below (up) or above (down), 70% of its height, with opacity | `count-up`, `count-down`               | 180ms               | `cubic-bezier(0.2, 0, 0, 1)`        | clipped by `overflow-hidden`         |
| Channel loading skeleton    | the block fades in after 300ms                                                       | `skeleton-in`, `both`                  | 150ms + 300ms delay | ease (CSS `ease-out`)               | a fast load never flashes it         |
| Skeleton shapes             | opacity 1 to 0.5 to 1, looping                                                       | Tailwind `animate-pulse`               | 2s                  | `cubic-bezier(0.4, 0, 0.6, 1)`      | `skeleton.ts`, loops                 |
| Field error                 | opacity, 4px drop into place                                                         | `field-error-enter`                    | 200ms               | CSS `ease-out`                      | `field.styles.ts`                    |
| Indeterminate progress      | 40% segment sweeps from -100% to 250%                                                | `progress-slide`, infinite             | 1.6s                | CSS `ease-in-out`                   | the one sweep that loops             |
| Progress value              | width                                                                                | transition                             | 200ms               | linear                              | `motion-reduce:transition-none`      |
| Typing and AI thinking dots | bounce, staggered                                                                    | Tailwind `animate-bounce`              | 1s, infinite        | per keyframe                        | `banners.ts`, `layouts.ts`           |
| Spinners (loader, pending)  | rotation                                                                             | SVG `animateTransform`, `animate-spin` | 0.83s, 1s           | stepped, linear                     | not a hazel primitive yet            |
| Lookup answers              | blur 4px, 3px rise, opacity                                                          | `blur-in`, `blur-in-stagger`           | 260ms               | ease-out                            | customers page only; not a primitive |
| Embed error card            | 8px rise, opacity                                                                    | `error-enter`                          | 300ms               | `ease-out-cubic`                    | embeds only; not a primitive         |
| Status dot `isPulsing`      | pulse                                                                                | `animate-pulse`                        | 2s                  | as above                            | no hazel caller                      |

### Hover and press

| Where                               | Properties                                | Duration | Easing      | Press                       |
| ----------------------------------- | ----------------------------------------- | -------- | ----------- | --------------------------- |
| Button                              | background, border, colour, shadow, scale | 150ms    | ease-out    | `active:scale-[0.98]`       |
| Badge                               | colours                                   | 200ms    | ease-out    |                             |
| Sidebar row (`sidebar.ts` item)     | none: hover colours switch at once        |          |             | same colours as hover       |
| Section chevron (sidebar group)     | transform                                 | 150ms    | default     |                             |
| Activity row, its hover action      | colours; the action's opacity             | 150ms    | default     |                             |
| DM card row (`chat-index/cards.ts`) | colours                                   | 200ms    | default     |                             |
| Phone rows and tabs                 | colours, opacity                          | 100ms    | default     | `active:opacity-60`         |
| Switch                              | default property list                     | 200ms    | ease-in-out |                             |
| Select, text field                  | background, border, shadow                | 150ms    | ease-out    |                             |
| Toast action, dialog close          | background, scale; colours                | 150ms    | ease-out    | toast action `scale-[0.97]` |

### Counts

Today's sidebar, rail and activity count badges (`ui/count-badge.ts`) do not animate: the number is
replaced in place. The only rolling count is a reaction pill's. The contract applies that same roll
(`countUp`, `countDown`) to `item.badge` too, as the motion brief asked; it is the one place the hazel
web moves where today does not, and it is one recipe line to drop if the user prefers today's.

### Reduce Motion

`styles.css` collapses everything: under `prefers-reduced-motion: reduce` every animation and
transition takes 0.01ms and plays once (`animation-iteration-count: 1`), delays stay (a skeleton still
waits 300ms), and `blur-in-stagger` drops its delays. A looping sweep therefore rests at its start.
The contract keeps exactly that: `reducedMotion: "instant"`. On the web codegen writes the same rule
for `[data-hz]` subtrees and their top-layer panels; on iOS, Reduce Motion (`accessibilityReduceMotion`)
means a motion jumps to its end pose with no animation and a loop does not run.

## The contract

- **Named motions** (`tokens.motion`): `fadeIn`, `scrimIn`, `tooltipIn`, `riseIn`, `scaleIn`,
  `slideUpIn`, `toastIn`, `toastOut`, `messageIn`, `reactionIn`, `reactionPop`, `countUp`, `countDown`,
  `skeletonIn`, `skeletonPulse`, `fieldErrorIn`, `progressSweep`, `bounce`. Each names keyframes
  (`tokens.keyframes`, poses of opacity, translate, scale), a duration and a curve from the tokens, and
  optionally a delay and `repeat: "forever"`. Nothing else may move: a new motion is a contract change.
- **Uses** (`recipe.motion`): a trigger (`enter`, `exit`, `countUp`, `countDown`, `pop`, `loop`), the
  motion, the part it plays on (or the panel's `::backdrop`), and a `regular` size-class override.
- **Transitions**: a declaration's `transition` (a duration) with `transitionEase` (a curve, `out` by
  default) for hover and press.
- **Web**: a renderer marks the element with `data-motion="<trigger>"` (`src/web/motion.ts`); the CSS
  plays it. An exit keeps the panel shown until its animation ends; a count change re-keys its number.
- **iOS**: `HazelTheme.Motion` carries the same keyframes, durations, curves and uses;
  `HazelUI/Sources/HazelUI/Motion/` plays them (SwiftUI views on a paused-at-rest `TimelineView`, the
  message list and typing dots on Core Animation). System presentations (menus, context menus,
  presented popovers, sheets, dialogs and the emoji picker sheet) keep the system's own transitions;
  the recipe's motions play where HazelUI draws the panel itself (in place, toasts). An exiting toast's
  node is held (`Tree.hold`) until `toastOut` ends.

| Primitive                  | enter                                                   | exit       | other                                          |
| -------------------------- | ------------------------------------------------------- | ---------- | ---------------------------------------------- |
| menu, popover, emojiPicker | `fadeIn` (panel)                                        |            |                                                |
| contextMenu                | `fadeIn` (panel)                                        |            |                                                |
| tooltip                    | `tooltipIn` (bubble)                                    |            |                                                |
| dialog                     | `riseIn`, `scaleIn` at regular; `scrimIn` (backdrop)    |            |                                                |
| sheet                      | `slideUpIn`, `scaleIn` at regular; `scrimIn` (backdrop) |            |                                                |
| toast                      | `toastIn` (panel)                                       | `toastOut` |                                                |
| message                    | `messageIn` (row, `entering`)                           |            | reactions: `reactionIn`, `reactionPop`, counts |
| reactionBar                | `reactionIn` (new pill)                                 |            | `reactionPop` (emoji), `countUp`/`countDown`   |
| item                       |                                                         |            | badge `countUp`/`countDown`                    |
| list                       | `skeletonIn` (skeleton)                                 |            | `skeletonPulse` loop (skeleton shapes)         |
| textField, textArea        | `fieldErrorIn` (error)                                  |            |                                                |
| progress                   |                                                         |            | `progressSweep` loop (fill, indeterminate)     |
| typingIndicator            |                                                         |            | `bounce` loop (dots)                           |
