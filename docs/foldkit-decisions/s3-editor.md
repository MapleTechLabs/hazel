# S3: Editor spike

Status: **passed** · 2026-10-07 · Branch `fk/s3-editor`

Question: can a vanilla editor inside a Foldkit Mount replace the Slate composer with identical pixels, faithful markdown round-trips and working mention autocomplete?

## Result

**ProseMirror** (vanilla, no React, no Tiptap) in a `Mount.defineStream`. The composer on `/dev/gallery/composer`, Foldkit against the working-tree legacy app (`legacy-head`):

| Variant                               | Perceptual px | Strict px | Structural deltas | Missing / extra | Console errors |
| ------------------------------------- | ------------- | --------- | ----------------- | --------------- | -------------- |
| composer-empty, light / dark          | **0** / **0** | 0 / 0     | **0**             | 0 / 0           | none           |
| composer-focused, light / dark        | **0** / **0** | 0 / 0     | **0**             | 0 / 0           | none           |
| composer-with-draft, light / dark     | **0** / **0** | 0 / 0     | **0**             | 0 / 0           | none           |
| composer-mention-autocomplete, l / d  | **0** / **0** | 0 / 0     | **0**             | 0 / 0           | none           |

- The scenarios type real text: `**bold**`, `_italic_`, `` `code` ``, two Shift+Enter line breaks, and a mention picked from the autocomplete with Enter. The autocomplete scenario types `Hey @g` and captures the open popover (avatars, status dots, highlighted row).
- `selfcheck --target legacy-head --filter composer-`: all 9 variants deterministic.
- Legacy guard (pinned `ef1fce35b` vs `legacy-head`, all scenarios): 28 identical, 1 sub-perceptual pass (notifications light, 9 strict px, unrelated), 8 fail. The 8 are the new composer variants, which the pinned baseline cannot render until the next re-pin.
- Serializer suite: **78/78** legacy cases pass against the ProseMirror model, plus 4 new decoration tests.

## Options compared

| | ProseMirror | Tiptap 3.31 (vanilla) | Lexical 0.52 (paper) |
| --- | --- | --- | --- |
| Editor bundle, minified + gzip (bare editor, measured with `bun build`) | **63 KB** | 102 KB (core + mention) | 77 KB (core + plain-text + history) |
| Markup control | Full: `toDOM` per node, inline decorations per leaf, widgets, node views | Same engine, plus defaults to turn off: injected CSS, `tiptap` class, `tabindex="0"`, core keymaps | `createDOM` per node class; text is managed by Lexical's own reconciler, so per-leaf markdown spans mean custom `TextNode` subclasses and transforms |
| Foldkit Mount | Prototyped and shipped | Prototyped: `Mount.defineStream`, `onUpdate` → Message, 24 Messages for 24 keystrokes, no errors | Would work (`registerUpdateListener`) |
| Mentions / autocomplete | Plugin state (~60 lines) | `@tiptap/suggestion` exists but owns its popup lifecycle | `LexicalTypeaheadMenuPlugin` is React-only |
| IME / mobile | Mature composition handling; plugins skip work while composing | Same (it is ProseMirror) | Good, but newer |
| Markdown round-trip | Faithful (78/78) | Same model, same result | Not tried |

The Tiptap prototype rendered our schema fine, but with defaults the editable gets `font-variant-ligatures: none` and `white-space: break-spaces` from injected CSS, a `tiptap` class and `tabindex="0"`. Each is a pixel or focus difference against legacy and needs an opt-out (`injectCSS: false`, `enableCoreExtensions: false`). Turning those off leaves ProseMirror with 40 KB more bundle and a second API on top. Lexical's React-only typeahead and reconciler-owned text DOM make exact leaf markup harder.

**Recommendation: ProseMirror.** The same Mount also covers the command-palette search editor.

## How it is wired

- `src/editor/` is framework-free (no Foldkit): `schema.ts` (node names equal the Slate `type`s; `toDOM` repeats the legacy `renderElement` markup), `markdown.ts` (serializer port), `decorations.ts` (legacy `decorateMarkdown` plus Slate's `Text.decorations` split/merge, bug for bug), `plugins.ts` (decorations, placeholder, autocomplete state), `behavior.ts` (the legacy `handleKeyDown`, autoformat and paste branches, same order), `editor-view.ts` (the `EditorView` and an id registry).
- `src/composer/` is the Submodel: `composer.ts` (Model, Messages, `MountEditor`, `KeepEditorFocus`, Commands), `update.ts` (legacy `useMentionOptions` and the index-based listbox navigation), `view.ts` (DropZone, Frame, popover, Actions), `data.ts` (the legacy members and presence live queries).
- **Mount:** `MountEditor({ editorId, placeholder })` creates the editor on its element with `Effect.acquireRelease` and streams `UpdatedDraft`, `ChangedAutocomplete`, `PressedAutocompleteKey`, `SubmittedDraft`, `PressedEscape` and `PressedArrowUpInEmpty`. `viewStateChanges` makes it read-only during time travel.
- **Model to editor:** Commands (`InsertMention`, `SyncAutocompleteOptions`, `CloseAutocomplete`) look the live view up by `editorId`. The Model owns the query, the active index and the candidates; the editor owns the document.
- **Subscriptions:** members of the channel (same query builder as legacy) and presence feed the Model through `liveQueryStream`.
- **Gallery:** legacy `dev-gallery/entries/composer.tsx` renders the real `SlateMessageComposer`; Foldkit `gallery/entries/composer.ts` embeds the Submodel with `h.submodel`.

## Gotchas found

| Gotcha | Fix |
| --- | --- |
| Slate merges overlapping decorations in order, so `**bold**` renders its content `italic` (the italic pattern matches inside it) | Port the merge, not the intent; a test pins the legacy leaves |
| ProseMirror has no empty text nodes and merges adjacent text | Serializer drops empty text; one test (untrusted emoji downgrade) asserts the merged text, with a note. Expected markdown is unchanged everywhere |
| A `toDOM` content hole must be the only child, but the legacy blockquote has an accent bar before its text | Bar is a widget decoration |
| Mention text was one text node, React writes `@` and the name as two, which the structural diff sees | `toDOM` emits two strings |
| Snabbdom recreates an unkeyed host when the popover is inserted before it, which would destroy the editor | Popover and editor host are keyed |
| Clicking an option blurs the editor, the blur closes the popover, and the click is lost | `KeepEditorFocus` Mount prevents mousedown default, like legacy `onMouseDown` |
| Legacy mention autocomplete reads `/_app/$orgSlug/chat/$id` params, so it throws outside the chat route | Legacy gallery renders inside a memory router with matching route ids |
| The editor must not capture arrows or Enter when the popover has no options | `SyncAutocompleteOptions` pushes the option count into plugin state; `aria-expanded` follows it |
| Slate sets `min-height` on the editable to the measured placeholder height | Placeholder plugin view does the same |

## Bundle

The Foldkit app grows from 322.6 to 397.3 KB gzipped (+74.7 KB) with the composer: ProseMirror plus the composer, detect-language and the gallery entry. Legacy lazy-loads its composer; if this matters, import ProseMirror inside the Mount's acquire Effect.

## Left for Phase 4

- Send, edit (Arrow Up in empty, Escape cancels), reply and edit indicators, typing indicator, clear and restore on send. `SubmittedDraft`, `PressedEscape` and `PressedArrowUpInEmpty` are already emitted and ignored.
- Bot commands (`/` trigger and the command input panel), emoji (`:` trigger) and mentionable bots in the mention list. The trigger state exists; options and views do not.
- Uploads: file paste and drag-and-drop (the DropZone button is inert), attachment previews, Attach, GIF and emoji pickers, custom emoji insertion.
- Prism highlighting inside code blocks (`slate-code-decorator.ts`), and `[text](url)` links, which legacy displays as only their text.
- Global typing redirect into the composer (`useGlobalKeyboardFocus`), scrolling the active option into view, the thread composer variant.
- Behavioral parity (RPC payloads per interaction) and IME and mobile checks on real devices.
