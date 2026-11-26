# Hazel UI contracts (phase 1)

The frozen interfaces the phase 2 lanes build against (`docs/hazel-ui.md`, "Phase 1: contracts").
Reviewed by the user on 2026-11-26 and updated in phase 1.5 with their decisions (below). Changing
anything here is a contract proposal. A lane starts from `LANES.md`.

## Decisions (2026-11-26)

1. `frame.surface` keeps the default `card`.
2. `section.action` stays a single action and also accepts menu entries (`Hazel.actionMenu`).
3. The governed composite cap stays at 1.
4. `message.row` uses readable keys only; G7's short keys are gone from the schema, goldens, bench
   and Swift decoder. Grouping is only the message's `grouped` flag.
5. `composer` stays a leaf with `above` and `actions` slots; the rich editor is phase 3.
6. Every proposed gap resolution is accepted, except `empty-illustration`, which is the new
   `emptyState` primitive. New tags `progress`, `emojiPicker`, `emptyState`; services `Files` and
   `Clipboard` (interfaces); the GIF picker is a web-only extension; `list.loading`'s skeleton is
   renderer-owned. `GAPS.md` is the resolved ledger.
7. Parity pass (phase 3, every proposal approved): the 48 gaps the phase 3 screens and lanes raised
   are resolved in `GAPS.md` ("Resolved in the parity pass"), with the lane that implements each.
   New tags `iconTile`, `channelIcon`, `peopleStrip`; keys reach the hosts (`row-key`); fixtures may
   wait on a lane with `pending`.
8. Motion (2026-11-26): C3 gains a motion layer (`MOTION.md`): named keyframes and motions as tokens,
   `recipe.motion` uses per trigger (enter, exit, counts, pop, loop), transition curves, and Reduce
   Motion as today's instant rule. Codegen writes the web CSS and `HazelTheme.Motion`; renderers only
   mark when (`src/web/motion.ts`). Checked against today by `bun scripts/test-motion.ts`.

| Contract      | Source of truth                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C0 scaffold   | `src/web/primitives/<group>/`, `HazelUI/Sources/HazelUI/{Wire,Tree,Runtime,Theme,Extensions,Primitives/<Group>}/`, `src/style/recipes/`, `src/custom/` |
| C1 vocabulary | `src/vocabulary/spec.ts` (tags), `options.ts` (closed sets), `content.ts` (structured props), `Hazel.ts` (builders)                                    |
| C2 wire       | `src/native/wire.ts`, mirrored by `HazelUI/.../Wire/Wire.swift`; goldens in `src/native/__goldens__/`                                                  |
| C3 style      | `src/style/schema.ts`, `src/style/recipe.ts`, `scripts/generate.ts`                                                                                    |

## C0: where each lane writes

- **Web renderers:** one file per tag, `src/web/primitives/<group>/<tag>.ts`, exporting
  `primitive = definePrimitive("<tag>", ...)`. `src/web/primitives.ts` finds them by `import.meta.glob`.
  Since phase 1.5 every tag has a file: the eleven G1/G5 renderers (stack, slot, ext, text, icon,
  avatar, screen, section, item, action, textField) and a `stubPrimitive("<tag>")` for the rest, which
  draws a box naming its lane (`data-hz-stub`); the lane replaces the stub. A tag with no file at all
  still throws `NotImplemented`.
- **Swift views:** one file per tag, `Primitives/<Group>/Hz<Tag>.swift`, pre-created as stubs that draw
  `NotImplementedView(tag, lane)`; the lane replaces the body. The tag-to-view switch
  (`Primitives/Registry.generated.swift`) and HazelUI's theme (`Theme/HazelTheme.generated.swift`) are
  written by `ui:generate` from the spec and recipes; lanes never edit them.
- **HazelUI is the one Swift package:** wire, `Tree`, `TreeView`, the `JSThread`/`JSEngine` runtime (moved
  from the spike app), G7's list and row code, and every primitive. The `EffectUiSpike` app now depends on
  it (`project.yml`) and uses its runtime and wire; the spike's own snapshot tree and views stay until
  **S0**, which moves the app onto `Tree`/`TreeView` and deletes them.
- **Recipes:** one file per primitive, `src/style/recipes/<tag>.ts`, written by the primitive's lanes
  (empty stubs for `progress`, `emptyState`, `emojiPicker`).
- **New tags:** `bun scripts/stubs.ts` (integrator) writes each missing web stub, Swift stub and
  default fixture once.
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
`.key(k)` on any element also sends the wire prop `key` (`Hazel.KEY_PROP`, `row-key`): hosts name
rows by it (`move`, `scrollTo({key})`, `popover.anchorTo`), and the web host writes `data-hz-key`.
Commands (`Hazel.Host`: `focus`, `blur`, `scrollTo`, `measure`, `select`) return Effects; the web host
implements `focus`/`blur`, the rest die with `NotImplemented` until lanes A2, A3, A4 and B.

| Tag               | Web / iOS | Children | Props                                                                                                                                                                                                                                  | Slots                      | Events                                                                                                                                      | Commands            |
| ----------------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `stack`           | A1 / S1   | elements | axis (default `vertical`), density (default `regular`), align (default `stretch`)                                                                                                                                                      | -                          | -                                                                                                                                           | -                   |
| `spacer`          | A1 / S1   | none     | -                                                                                                                                                                                                                                      | -                          | -                                                                                                                                           | -                   |
| `scroll`          | A1 / S1   | elements | axis (default `vertical`)                                                                                                                                                                                                              | -                          | -                                                                                                                                           | scrollTo            |
| `frame`           | A1 / S1   | elements | surface (default `card`)                                                                                                                                                                                                               | -                          | -                                                                                                                                           | -                   |
| `divider`         | A1 / S1   | none     | -                                                                                                                                                                                                                                      | -                          | -                                                                                                                                           | -                   |
| `list`            | A4 / S5   | elements | anchor (default `start`), stickToBottom?, loading? (skeleton, renderer-owned), loadingStart?, loadingEnd?, reorderable?                                                                                                                | overlay                    | reachStart, reachEnd, move                                                                                                                  | scrollTo            |
| `listDivider`     | A4 / S5   | none     | kind (default `date`), label                                                                                                                                                                                                           | -                          | -                                                                                                                                           | -                   |
| `text`            | A1 / S1   | text     | role (default `body`), tone (default `default`), strong?, numeric?, truncate?                                                                                                                                                          | -                          | -                                                                                                                                           | -                   |
| `heading`         | A1 / S1   | text     | level (default `2`)                                                                                                                                                                                                                    | -                          | -                                                                                                                                           | -                   |
| `icon`            | A1 / S1   | none     | name (data)                                                                                                                                                                                                                            | -                          | -                                                                                                                                           | -                   |
| `image`           | A1 / S1   | none     | src, alt, width, height                                                                                                                                                                                                                | -                          | press                                                                                                                                       | -                   |
| `avatar`          | A1 / S1   | none     | name (seeds the fallback tint), initials, src, presence (default `none`), size (default `regular`), mark (default `none`)                                                                                                              | -                          | press                                                                                                                                       | -                   |
| `avatarStack`     | A1 / S1   | elements | overflow, layout (default `row`)                                                                                                                                                                                                       | -                          | -                                                                                                                                           | -                   |
| `iconTile`        | A1 / S1   | none     | name (data), tone (default `neutral`)                                                                                                                                                                                                  | -                          | -                                                                                                                                           | -                   |
| `channelIcon`     | A1 / S1   | none     | emoji, private?, customer (data: `Logo`), partners (data: `Logo[]`), sync (default `none`)                                                                                                                                             | -                          | -                                                                                                                                           | -                   |
| `peopleStrip`     | A1 / S1   | none     | people (data: `StripPerson[]`)                                                                                                                                                                                                         | -                          | press                                                                                                                                       | -                   |
| `badge`           | A1 / S1   | none     | label, tone (default `neutral`), style (default `solid`), size (default `regular`), pill?                                                                                                                                              | -                          | -                                                                                                                                           | -                   |
| `progress`        | A1 / S1   | none     | value (0 to 1), indeterminate?, label                                                                                                                                                                                                  | -                          | -                                                                                                                                           | -                   |
| `emptyState`      | A1 / S1   | none     | title, description, icon (data), illustration (default `none`)                                                                                                                                                                         | action                     | -                                                                                                                                           | -                   |
| `richText`        | A1 / S1   | none     | blocks (data)                                                                                                                                                                                                                          | -                          | pressMention (with `run`), pressLink                                                                                                        | -                   |
| `message`         | A5 / S5   | none     | row (data), grouped?, pinned?, highlighted?, entering?, pending?, failed?                                                                                                                                                              | -                          | press, longPress, action, pressAuthor, pressReaction, addReaction, pressMention, pressLink, pressAttachment, pressReply, pressThread, retry | -                   |
| `reactionBar`     | A5 / S5   | none     | reactions (data), addable?                                                                                                                                                                                                             | -                          | pressReaction, add                                                                                                                          | -                   |
| `attachmentGrid`  | A5 / S5   | none     | attachments (data), removable?                                                                                                                                                                                                         | -                          | press, remove                                                                                                                               | -                   |
| `embed`           | A5 / S5   | none     | embed (data)                                                                                                                                                                                                                           | -                          | press                                                                                                                                       | -                   |
| `typingIndicator` | A5 / S5   | none     | names (data)                                                                                                                                                                                                                           | -                          | -                                                                                                                                           | -                   |
| `button`          | A2 / S2   | none     | label, icon (data), variant (default `primary`), size (default `regular`), iconOnly?, circle?, selected?, disabled?, loading?                                                                                                          | -                          | press                                                                                                                                       | focus               |
| `link`            | A2 / S2   | none     | label, href                                                                                                                                                                                                                            | -                          | press                                                                                                                                       | -                   |
| `textField`       | A2 / S2   | none     | label, placeholder, description, value (revisioned), error, disabled?, readOnly?, required?, monospace?                                                                                                                                | -                          | change, submit, focus, blur                                                                                                                 | focus, blur, select |
| `textArea`        | A2 / S2   | none     | label, placeholder, description, value (revisioned), error, disabled?                                                                                                                                                                  | -                          | change, submit, focus, blur                                                                                                                 | focus, blur, select |
| `toggle`          | A2 / S2   | none     | label, description, checked?, disabled?                                                                                                                                                                                                | -                          | change                                                                                                                                      | -                   |
| `select`          | A2 / S2   | none     | label, placeholder, options (data), value, disabled?                                                                                                                                                                                   | -                          | change                                                                                                                                      | -                   |
| `searchField`     | A2 / S2   | none     | placeholder, value (revisioned)                                                                                                                                                                                                        | -                          | change, submit                                                                                                                              | focus, blur         |
| `composer`        | A2 / S2   | none     | placeholder, value (revisioned), disabled?, canSend?                                                                                                                                                                                   | above, actions             | change, submit, focus, blur, trigger, key, files                                                                                            | focus, blur, select |
| `menu`            | A3 / S3   | none     | label, entries (data)                                                                                                                                                                                                                  | trigger                    | select                                                                                                                                      | -                   |
| `contextMenu`     | A3 / S3   | elements | entries (data)                                                                                                                                                                                                                         | -                          | select                                                                                                                                      | -                   |
| `sheet`           | A3 / S3   | elements | open?, title                                                                                                                                                                                                                           | -                          | dismiss                                                                                                                                     | -                   |
| `dialog`          | A3 / S3   | elements | open?, title, description, destructive?                                                                                                                                                                                                | actions                    | dismiss                                                                                                                                     | -                   |
| `popover`         | A3 / S3   | elements | open?, anchorTo (data: `{key, run}`)                                                                                                                                                                                                   | anchor                     | dismiss                                                                                                                                     | -                   |
| `toast`           | A3 / S3   | none     | open?, tone (default `neutral`), title, description                                                                                                                                                                                    | action                     | dismiss                                                                                                                                     | -                   |
| `tooltip`         | A3 / S3   | elements | label                                                                                                                                                                                                                                  | -                          | -                                                                                                                                           | -                   |
| `emojiPicker`     | A3 / S3   | none     | open?                                                                                                                                                                                                                                  | -                          | select, dismiss                                                                                                                             | -                   |
| `screen`          | A4 / S4   | elements | title, back?                                                                                                                                                                                                                           | toolbar, floatingAction    | back                                                                                                                                        | -                   |
| `navigation`      | A4 / S4   | elements | -                                                                                                                                                                                                                                      | -                          | pop                                                                                                                                         | -                   |
| `tabBar`          | A4 / S4   | elements | tabs (data), selected                                                                                                                                                                                                                  | -                          | change                                                                                                                                      | -                   |
| `splitView`       | A4 / S4   | elements | -                                                                                                                                                                                                                                      | sidebar                    | -                                                                                                                                           | -                   |
| `section`         | A4 / S4   | elements | title, collapsible?, collapsed?, reorderable?                                                                                                                                                                                          | -                          | toggle, move                                                                                                                                | -                   |
| `item`            | A4 / S4   | elements | title, subtitle, badge, emphasized?, selected?, disabled?, muted?, nested (default `none`), unread (default `none`), titleLines (default `1`), subtitleLines (default `1`), leadingSize (default `regular`), shortcut (web only), href | leading, trailing, actions | press, longPress                                                                                                                            | scrollTo            |
| `slot`            | A1 / S1   | elements | name                                                                                                                                                                                                                                   | -                          | -                                                                                                                                           | -                   |
| `action`          | A4 / S4   | elements | label, entries (data)                                                                                                                                                                                                                  | -                          | press, select                                                                                                                               | -                   |
| `ext`             | A1 / S0   | elements | ext, args (data)                                                                                                                                                                                                                       | fallback                   | -                                                                                                                                           | -                   |

`slot`, `ext` and `action` are internal: what slots, `h.extension` and `section.action(icon, msg | actionMenu, label)`
compile to. Structured props (`row`, `blocks`, `entries`, `reactions`, `attachments`, `tabs`, `options`,
`anchorTo`, `customer`, `partners`, `people`) are Schemas in `content.ts`. A `message.row` has readable keys only: `author`, `initials`,
`avatar`, `provider`, `time`, `body`, `reactions` (`{emoji, count, mine, who?}`), `quick`, `edited`,
`status`, `badges`, `reply`, `files`, `embeds`, `thread` (with an optional `name`), `actions`. Rich text runs and blocks stay
compact tuples. `MenuEntry.entries` is a one-level submenu.

Extensions: `GifPicker` (`src/extensions/GifPicker.ts`, web only, lane A3). Services (interfaces in
`packages/client-data/src/platform/ui-services.ts`, lane F implements web and Swift): `Files.pick`,
`Files.dropped`, `Clipboard.write`; screens reach them through a `Command.Service`.

### Closed sets, and what changed

Unchanged from the doc and G6: `text.tone`, `text.strong`, `button.variant` (default
`primary`), `button.size` + `iconOnly`/`circle`, `badge.tone`/`style`/`size` + `pill`, the view states.

Values fixed in C1 for props the doc names without values (each needs your sign-off):

| Set                                | Values (default first)                                                    | Reason                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `stack.axis`                       | `vertical`, `horizontal`                                                  | doc names `axis`                                                                                             |
| `stack.density`                    | `regular`, `compact`, `relaxed`                                           | doc's values                                                                                                 |
| `stack.align`                      | `stretch`, `start`, `center`, `end`                                       | doc names `align`; the screens use `start`, `center`, `end`                                                  |
| `text.role`                        | `body`, `label`, `caption`, `title`, `display`, `code`, `overline`, `kbd` | `overline`: the kit's uppercase group label; `kbd`: a key cap inside a line (parity pass)                    |
| `button.variant`                   | the doc's six, plus `chip` (with flag `selected`)                         | `filter-chip`                                                                                                |
| `frame.surface`                    | `card`, `none`, `inset`, `muted`, `overlay`, `danger`, `flush`            | doc's values; default `card`; `danger` from `frame-danger`, `flush` from `frame-flush`                       |
| `heading.level`                    | `2`, `1`, `3`                                                             | screen, section, group titles                                                                                |
| `avatar.presence`                  | `none`, `online`, `away`, `busy`, `offline`                               | the app's presence states                                                                                    |
| `avatar.size`                      | `regular`, `medium`, `large`                                              | `avatar-large`; `medium` is the kit's `md` (`avatar-row-size`)                                               |
| `avatarStack.layout`               | `row`, `pair`                                                             | `dm-group-avatar`                                                                                            |
| `iconTile.tone`                    | `neutral`, `accent`, `success`, `warning`, `danger`                       | the kit's `iconTile` intents                                                                                 |
| `item.unread`                      | `none`, `pip`, `dot`                                                      | `item-unread-pip`, `item-unread-dot`                                                                         |
| `item.titleLines`, `subtitleLines` | `1`, `2`                                                                  | `item-title-lines`, `item-subtitle-lines`                                                                    |
| `item.leadingSize`                 | `regular`, `large`                                                        | `item-leading-size`                                                                                          |
| `avatar.mark`, `channelIcon.sync`  | `none`, `slack`, `discord`                                                | `avatar-provider-mark`, `icon-mark` (`row.provider` takes the same without `none`)                           |
| `item.nested`                      | `none`, `middle`, `last`                                                  | `thread-elbow`                                                                                               |
| `emptyState.illustration`          | `none`, `squirrel`                                                        | today's message-list empty state; an asset per platform                                                      |
| `composer` key                     | `up down enter tab escape`                                                | `autocomplete-keys`                                                                                          |
| `listDivider.kind`                 | `date`, `unread`                                                          | doc's values                                                                                                 |
| `list.anchor`                      | `start`, `end`                                                            | `end` is a chat (anchors on prepend, G7)                                                                     |
| `toast.tone`                       | the badge tones                                                           | no new set                                                                                                   |
| `MessageAction`                    | `react reply thread copy edit pin unpin issue selectText delete`          | the hover toolbar and More menu; `issue` from phase 1.5; `selectText` (iOS) from the parity pass             |
| `composer` trigger                 | `@ # / :`                                                                 | mentions, channels, commands, emoji                                                                          |
| `IconName`                         | 37 names, each mapped to a web icon (`iconSources`)                       | what the screens draw, plus `slack` and `discord`; `folder-plus`, `messages`, `support` from the parity pass |

Removed: G7's short row keys. Added in phase 1.5 and the parity pass: everything in `GAPS.md`.

## C2: the wire (v2)

`{"v": 2, "seq": n, "ops": [...]}`, one batch per flush, `seq` gapless, ids from the host (0 is the root).

| Op        | Fields                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------ |
| `create`  | id, tag (`hz:*`, `#text`, `#container`)                                                          |
| `props`   | id, changed keys (null deletes); `controlled` values carry `{text, rev, edit}` and never go back |
| `text`    | id, text                                                                                         |
| `insert`  | parent, id, before or null (moves an existing or detached id)                                    |
| `remove`  | id (frees the subtree)                                                                           |
| `events`  | id, event names                                                                                  |
| `detach`  | id (kept alive outside the tree)                                                                 |
| `command` | request, id, name (`focus blur scrollTo measure select`), args                                   |

Back to JS, one JSON array per message to `__hazel.receive(json)`: `["fire", id, event, payload, seq]`
and `["reply", request, ok, result]`. Delivery: `JSON.stringify(batch)` to `__native.post`, read in Swift
as UTF-8 bytes (`WireBytes.utf8`, never through `String`). Goldens: `host-session` (mount, prop change,
keyed reorder, removal; the native host must still emit it), `detach-reattach`, `structured-props`,
`text-revision`, `commands`, `utf8`, `rejects`. Both sides print the same canonical text per op and the
same tree outline per step.

## C3: style

`schema.ts` is frozen with the gate-era declarations (`ring`, `divider`, `leading`, `stroke`, `bleedX`,
`lessBorder`...), plus from the parity pass `weight` (`semibold`, `bold`), `uppercase`, `textAlign`,
`lineClamp`, `overflow` and `align: "end"`; tokens gained those weights, the `overline` and `kbd` steps,
`scrim` and the `overlay` shadow. Swift's `Style` carries the new fields; `Tree/Styling.swift` (S0)
and each primitive read them. `recipeFeatures` lists what a recipe can say; `rendererFeatures` what a web renderer
owns instead (hit areas, forced colours, foreign selectors, other breakpoints, focus rings, animations).
A recipe file exports one `defineRecipe({ primitive: <tag key>, parts, base, options, flags, states,
compounds, inert })`; a message's own states are `flags`. Codegen: `generateCss(tokens, recipes)` and
`generateSwift(tokens, recipes)` (strings), `generateSwiftRegistry()`; `ui:check` fails when stale.

## Gaps

All 25 phase 1 gaps and the 48 of the parity pass are resolved (`GAPS.md`); new ones go under its
"Open".

## Fixtures waiting on a lane

A fixture's `pending: {web?, ios?}` names the lanes that have not drawn it yet; `test:web` and
`SnapshotTests` skip its cases as "not implemented: lane X". The lane deletes its entry when it draws
the case (and, on iOS, records the snapshots).

## Verification per lane

Each lane's one command, owned paths, tags and done-when are in `LANES.md` (phase 1.5). Contract
checks: `bun run --cwd packages/ui test:contracts`.
