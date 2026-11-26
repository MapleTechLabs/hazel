# Hazel UI gaps

What the phase 1 screens (`apps/shared-screens/src/{chat,composer,channel-sidebar,settings}`) needed
and the C1 vocabulary does not yet say. Each call site carries `// HAZEL-GAP(<id>): <need>`; lanes keep
working with the nearest option meanwhile. The user resolves each row; a resolution lands with both
renderers, its fixtures and a gallery entry.

Kinds: **option** (a value in a closed set), **prop** (a prop, flag or event on an existing tag),
**primitive** (a new tag), **composite** (a governed `h.custom`), **service** (a platform service, not
vocabulary), **renderer** (decided inside the primitive, no API change).

| Id | Screen | Need | Proposed resolution | Kind |
| --- | --- | --- | --- | --- |
| `message-provider` | message | Slack or Discord mark after a synced author's name | `row.provider: "slack" \| "discord"`, drawn by the row; icons `slack`, `discord` | prop |
| `reaction-who` | message | tooltip naming who reacted | `Reaction` gains a 4th field: up to 3 names plus the rest's count | prop |
| `quick-reactions` | message | three quick emoji in the hover toolbar | `row.quick: string[]`; presses raise the existing `pressReaction` | prop |
| `message-action-issue` | message | "Create issue" in More | add `issue` to `MessageAction` | option |
| `anchor-in-leaf` | message | profile popover anchored at a mention inside the row | `popover.anchorTo({node, run})`: a leaf reports run rects through `measure` | prop |
| `list-overlay-bar` | message list | "N new messages" bar floating over the list's top | `list` slot `overlay` (top edge, over rows) | prop |
| `skeleton` | message list | skeleton rows while loading | `list.loading` draws skeleton rows (replaces `loadingEnd` for an empty list) | renderer |
| `empty-illustration` | message list | the empty state's illustration | `image.asset(name)` from a closed asset set, or an `emptyState` primitive | option |
| `autocomplete-keys` | composer | arrows, Enter, Tab, Escape drive suggestions while a trigger is open | `composer` event `key {key: "up" \| "down" \| "enter" \| "tab" \| "escape"}`, raised only while `trigger` is open | prop |
| `file-picker` | composer, settings | pick files and upload them natively | platform service `Files.pick` (Command), returning attachment ids | service |
| `file-drop` | composer | drop or paste files | `composer` event `files {count}` with the files handed to the same service | prop |
| `emoji-gif-picker` | composer | emoji and GIF picker dialogs | `emojiPicker` primitive (system-like on iOS); GIF as a web extension | primitive |
| `avatar-provider-mark` | composer | presence dot or provider mark on a mention's avatar | `avatar.presence` covers presence; add `avatar.mark: "slack" \| "discord"` | prop |
| `field-required` | composer | required marker on bot command fields | `textField.required` flag | prop |
| `thread-elbow` | sidebar | thread rows hang off their channel with an elbow | `item.nested: "middle" \| "last"` (the elbow's shape), drawn by the item | prop |
| `item-muted` | sidebar | muted channel and discover rows are dimmed | `item.muted` flag (not `disabled`: still pressable) | prop |
| `section-action-menu` | sidebar | a section's "+" opens a menu | `section.action` also takes `menu` entries, or a `section` slot `actions` holding a `menu` | prop |
| `kbd-hint` | sidebar | keyboard shortcut at a row's end | `item.shortcut: string` (web only; iOS ignores it) | prop |
| `menu-submenu` | sidebar | "Notifications", "Move to section" submenus | `MenuEntry.entries` (one level), maps to `UIMenu` children | prop |
| `drag-reorder` | sidebar | reorder channels and sections by drag | `list`/`section` `reorderable` flag and a `move {id, before}` event | prop |
| `avatar-large` | settings | large logo avatar that is the upload button | `avatar.size: "regular" \| "large"` plus `press` on avatar | option |
| `field-monospace` | settings | the workspace URL reads as code | `textField.monospace` flag, or a read-only `code` field kind | prop |
| `clipboard` | settings | copy the workspace URL | platform service `Clipboard.write` (lane F) | service |
| `progress` | settings | export progress bar | `progress` primitive (`value` 0 to 1, `indeterminate`) | primitive |
| `frame-danger` | settings | danger zone card with a tinted header | `frame.surface` value `danger` | option |

Headline: 25 gaps; 16 props, 3 options, 2 primitives (`progress`, `emojiPicker`), 2 platform
services, 1 renderer decision, 1 either option or primitive. None needs a new closed set of styles
beyond `frame.surface: danger` and `avatar.size`.
