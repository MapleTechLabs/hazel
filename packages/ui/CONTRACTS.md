# Hazel UI contracts (phase 1)

The frozen interfaces the phase 2 lanes build against (`docs/hazel-ui.md`, "Phase 1: contracts").
For review by the user before any lane starts. Changing anything here is a contract proposal.

| Contract | Source of truth |
| --- | --- |
| C0 scaffold | `src/web/primitives/<group>/`, `HazelUI/Sources/HazelUI/{Wire,Tree,Runtime,Theme,Extensions,Primitives/<Group>}/`, `src/style/recipes/`, `src/custom/` |
| C1 vocabulary | `src/vocabulary/spec.ts` (tags), `options.ts` (closed sets), `content.ts` (structured props), `Hazel.ts` (builders) |
| C2 wire | `src/native/wire.ts`, mirrored by `HazelUI/.../Wire/Wire.swift`; goldens in `src/native/__goldens__/` |
| C3 style | `src/style/schema.ts`, `src/style/recipe.ts`, `scripts/generate.ts` |

## C0: where each lane writes

- **Web renderers:** one file per tag, `src/web/primitives/<group>/<tag>.ts`, exporting
  `primitive = definePrimitive("<tag>", ...)`. `src/web/primitives.ts` finds them by `import.meta.glob`;
  a `hazel` tag with no file throws `NotImplemented` naming its lane. Eleven G1/G5 renderers are already
  moved in (stack, slot, ext, text, icon, avatar, screen, section, item, action, textField).
- **Swift views:** one file per tag, `Primitives/<Group>/Hz<Tag>.swift`, pre-created as stubs that draw
  `NotImplementedView(tag, lane)`; the lane replaces the body. The tag-to-view switch
  (`Primitives/Registry.generated.swift`) and HazelUI's theme (`Theme/HazelTheme.generated.swift`) are
  written by `ui:generate` from the spec and recipes; lanes never edit them.
- **HazelUI is the one Swift package:** wire, `Tree`, `TreeView`, the `JSThread`/`JSEngine` runtime (moved
  from the spike app), G7's list and row code, and every primitive. The `EffectUiSpike` app now depends on
  it (`project.yml`) and uses its runtime and wire; the spike's own snapshot tree and views stay until
  **S0**, which moves the app onto `Tree`/`TreeView` and deletes them.
- **Recipes:** one file per primitive, `src/style/recipes/<tag>.ts`, written by the primitive's lanes.
- **Composites:** one file per composite, `src/custom/<Name>.ts` (`Hazel.composite`), capped by
  `hazel/custom-cap` at **1** (`SettingsHeader`).
- No new dependencies were added. After C0 no lane needs `bun.lock`, the root `package.json`,
  `project.yml`, CI, `.oxlintrc.json` or generated files.

## C1: the vocabulary

Every builder is typed from `spec.ts`: a chain method per prop and slot, `.on(event, ...)` with the
event's typed payload, `.key(...)`, and `children` typed by the tag's content (`elements`, `text`, or
none for a leaf). Setting a prop to its default sends nothing. `attr`, `attrs`, `prop` are `never` and
throw; `h.el` is `never`; `hazel/no-raw-escape` closes the rest in `apps/shared-screens`.
`h.extension(def, props)` and `h.custom(composite, props, on?)` are the only other entries.
Commands (`Hazel.Host`: `focus`, `blur`, `scrollTo`, `measure`, `select`) return Effects; the web host
implements `focus`/`blur`, the rest die with `NotImplemented` until lanes A2, A3, A4 and B.

| Tag | Web / iOS | Children | Props | Slots | Events | Commands |
| --- | --- | --- | --- | --- | --- | --- |
| `stack` | A1 / S1 | elements | axis (default `vertical`), density (default `regular`), align (default `stretch`) | - | - | - |
| `spacer` | A1 / S1 | none | - | - | - | - |
| `scroll` | A1 / S1 | elements | axis (default `vertical`) | - | - | scrollTo |
| `frame` | A1 / S1 | elements | surface (default `card`) | - | - | - |
| `divider` | A1 / S1 | none | - | - | - | - |
| `list` | A4 / S5 | elements | anchor (default `start`), stickToBottom?, loadingStart?, loadingEnd? | - | reachStart, reachEnd | scrollTo |
| `listDivider` | A4 / S5 | none | kind (default `date`), label | - | - | - |
| `text` | A1 / S1 | text | role (default `body`), tone (default `default`), strong?, numeric?, truncate? | - | - | - |
| `heading` | A1 / S1 | text | level (default `2`) | - | - | - |
| `icon` | A1 / S1 | none | name (data) | - | - | - |
| `image` | A1 / S1 | none | src, alt, width, height | - | press | - |
| `avatar` | A1 / S1 | none | name, initials, src, presence (default `none`) | - | - | - |
| `avatarStack` | A1 / S1 | elements | overflow | - | - | - |
| `badge` | A1 / S1 | none | label, tone (default `neutral`), style (default `solid`), size (default `regular`), pill? | - | - | - |
| `richText` | A1 / S1 | none | blocks (data) | - | pressMention, pressLink | - |
| `message` | A5 / S5 | none | row (data), grouped?, pinned?, highlighted?, entering?, pending?, failed? | - | press, longPress, action, pressAuthor, pressReaction, addReaction, pressMention, pressLink, pressAttachment, pressReply, pressThread, retry | - |
| `reactionBar` | A5 / S5 | none | reactions (data), addable? | - | pressReaction, add | - |
| `attachmentGrid` | A5 / S5 | none | attachments (data), removable? | - | press, remove | - |
| `embed` | A5 / S5 | none | embed (data) | - | press | - |
| `typingIndicator` | A5 / S5 | none | names (data) | - | - | - |
| `button` | A2 / S2 | none | label, icon (data), variant (default `primary`), size (default `regular`), iconOnly?, circle?, disabled?, loading? | - | press | focus |
| `link` | A2 / S2 | none | label, href | - | press | - |
| `textField` | A2 / S2 | none | label, placeholder, description, value (revisioned), error, disabled?, readOnly? | - | change, submit, focus, blur | focus, blur, select |
| `textArea` | A2 / S2 | none | label, placeholder, description, value (revisioned), error, disabled? | - | change, submit, focus, blur | focus, blur, select |
| `toggle` | A2 / S2 | none | label, description, checked?, disabled? | - | change | - |
| `select` | A2 / S2 | none | label, placeholder, options (data), value, disabled? | - | change | - |
| `searchField` | A2 / S2 | none | placeholder, value (revisioned) | - | change, submit | focus, blur |
| `composer` | A2 / S2 | none | placeholder, value (revisioned), disabled?, canSend? | above, actions | change, submit, focus, blur, trigger | focus, blur, select |
| `menu` | A3 / S3 | none | label, entries (data) | trigger | select | - |
| `contextMenu` | A3 / S3 | elements | entries (data) | - | select | - |
| `sheet` | A3 / S3 | elements | open?, title | - | dismiss | - |
| `dialog` | A3 / S3 | elements | open?, title, description, destructive? | actions | dismiss | - |
| `popover` | A3 / S3 | elements | open? | anchor | dismiss | - |
| `toast` | A3 / S3 | none | open?, tone (default `neutral`), title, description | action | dismiss | - |
| `tooltip` | A3 / S3 | elements | label | - | - | - |
| `screen` | A4 / S4 | elements | title, back? | toolbar | back | - |
| `navigation` | A4 / S4 | elements | - | - | pop | - |
| `tabBar` | A4 / S4 | elements | tabs (data), selected | - | change | - |
| `splitView` | A4 / S4 | elements | - | sidebar | - | - |
| `section` | A4 / S4 | elements | title, collapsible?, collapsed? | - | toggle | - |
| `item` | A4 / S4 | elements | title, subtitle, badge, emphasized?, selected?, disabled?, href | leading, trailing | press, longPress | scrollTo |
| `slot` | A1 / S1 | elements | name | - | - | - |
| `action` | A4 / S4 | elements | label | - | press | - |
| `ext` | A1 / S0 | elements | ext, args (data) | fallback | - | - |

`slot`, `ext` and `action` are internal: what slots, `h.extension` and `section.action(icon, msg, label)`
compile to. Structured props (`row`, `blocks`, `entries`, `reactions`, `attachments`, `tabs`, `options`)
are Schemas in `content.ts`; a `message.row` keeps G7's short keys `a i t b r` and adds readable optional
fields (`avatar`, `edited`, `status`, `badges`, `reply`, `files`, `embeds`, `thread`, `actions`).

### Closed sets, and what changed

Unchanged from the doc and G6: `text.role`, `text.tone`, `text.strong`, `button.variant` (default
`primary`), `button.size` + `iconOnly`/`circle`, `badge.tone`/`style`/`size` + `pill`, the view states.

Values fixed in C1 for props the doc names without values (each needs your sign-off):

| Set | Values (default first) | Reason |
| --- | --- | --- |
| `stack.axis` | `vertical`, `horizontal` | doc names `axis` |
| `stack.density` | `regular`, `compact`, `relaxed` | doc's values |
| `stack.align` | `stretch`, `start`, `center`, `end` | doc names `align`; the screens use `start`, `center`, `end` |
| `frame.surface` | `card`, `none`, `inset`, `muted`, `overlay` | doc's values; default `card` because every settings frame is one |
| `heading.level` | `2`, `1`, `3` | screen, section, group titles |
| `avatar.presence` | `none`, `online`, `away`, `busy`, `offline` | the app's presence states |
| `listDivider.kind` | `date`, `unread` | doc's values |
| `list.anchor` | `start`, `end` | `end` is a chat (anchors on prepend, G7) |
| `toast.tone` | the badge tones | no new set |
| `MessageAction` | `react reply thread copy edit pin unpin delete` | the hover toolbar and More menu |
| `composer` trigger | `@ # / :` | mentions, channels, commands, emoji |
| `IconName` | 32 names, each mapped to a web icon (`iconSources`) | was 5; grew to exactly what the four screens draw |

Removed: nothing. Not added (gaps instead): `avatar.size`, `frame.surface: danger`, `item.muted`.

## C2: the wire (v2)

`{"v": 2, "seq": n, "ops": [...]}`, one batch per flush, `seq` gapless, ids from the host (0 is the root).

| Op | Fields |
| --- | --- |
| `create` | id, tag (`hz:*`, `#text`, `#container`) |
| `props` | id, changed keys (null deletes); `controlled` values carry `{text, rev, edit}` and never go back |
| `text` | id, text |
| `insert` | parent, id, before or null (moves an existing or detached id) |
| `remove` | id (frees the subtree) |
| `events` | id, event names |
| `detach` | id (kept alive outside the tree) |
| `command` | request, id, name (`focus blur scrollTo measure select`), args |

Back to JS, one JSON array per message to `__hazel.receive(json)`: `["fire", id, event, payload, seq]`
and `["reply", request, ok, result]`. Delivery: `JSON.stringify(batch)` to `__native.post`, read in Swift
as UTF-8 bytes (`WireBytes.utf8`, never through `String`). Goldens: `host-session` (mount, prop change,
keyed reorder, removal; the native host must still emit it), `detach-reattach`, `structured-props`,
`text-revision`, `commands`, `utf8`, `rejects`. Both sides print the same canonical text per op and the
same tree outline per step.

## C3: style

`schema.ts` is frozen with the gate-era declarations (`ring`, `divider`, `leading`, `stroke`, `bleedX`,
`lessBorder`...). `recipeFeatures` lists what a recipe can say; `rendererFeatures` what a web renderer
owns instead (hit areas, forced colours, foreign selectors, other breakpoints, focus rings, animations).
A recipe file exports one `defineRecipe({ primitive: <tag key>, parts, base, options, flags, states,
compounds, inert })`; a message's own states are `flags`. Codegen: `generateCss(tokens, recipes)` and
`generateSwift(tokens, recipes)` (strings), `generateSwiftRegistry()`; `ui:check` fails when stale.

## Gaps

25 gaps from the four screens (`GAPS.md`): 16 props, 3 options, 2 primitives (`progress`,
`emojiPicker`), 2 platform services (file picker, clipboard), 1 renderer decision, 1 open
(`empty-illustration`). The largest clusters: chat row details (provider mark, who reacted, quick
reactions), file handling, and sidebar row states (muted, nested thread, shortcut hint, submenus).

## Verification per lane

| Lane | Command (from the repo root) |
| --- | --- |
| A1 to A5 (web) | `bun run --cwd packages/ui typecheck && (cd packages/ui && bunx vitest run src/web)` |
| B (native host) | `(cd packages/ui && bunx vitest run src/native)` |
| S0 to S5 (Swift) | `bash apps/ios-hybrid/HazelUI/Bench/build-js.sh && (cd apps/ios-hybrid/HazelUI && xcodebuild test -scheme HazelUI -destination 'platform=iOS Simulator,id=<pinned>' -derivedDataPath .build/xcode)` |
| D (tokens, recipes) | `bun run --cwd packages/ui ui:check && (cd packages/ui && bunx vitest run src/style scripts/generate.test.ts)` |
| F (platform services) | `bun run --cwd packages/client-data typecheck && bun run --cwd packages/client-data test && bash apps/ios-hybrid/scripts/build-effect-ui.sh` |
| Screens | `bun run --cwd apps/shared-screens typecheck && bunx oxlint --disable-nested-config --quiet apps/shared-screens` |
| Contract checks | `(cd packages/ui && bunx vitest run src/native/wire.test.ts scripts/hazel-lint.test.ts)` |

Phase 1.5 replaces the web rows with the browser runner and adds fixtures and snapshots.
