# Foldkit review: pages

Scope: everything under `apps/web-foldkit/src/page/` except `page/chat*`, `page/chat-index` and
`page/registry.ts`. That is settings (general, invitations, team, custom emojis, connect invites, chat
sync, chat sync connection, integrations index / installed / marketplace / your-apps / detail, debug),
my-settings (profile, appearance, notifications, linked accounts, desktop), channel settings (overview,
integrations, connect, redirect), onboarding (incl. setup organization), home, notifications inbox,
join, select organization, profile, root and auth.

Graded against the Foldkit docs for the installed 0.167.0 (architecture, testing, Story, Scene,
project organization, commands, subscriptions, mount, managed resources, resources, submodel,
messages, anti-patterns) and the page contract in `src/page/README.md`. Every finding below was
checked in the code; line numbers are at `7d7b2e69f`. Paths are relative to `apps/web-foldkit/src/`.

Doc links used below:
[anti-patterns](https://foldkit.dev/patterns/anti-patterns),
[stale results](https://foldkit.dev/patterns/anti-patterns#reject-stale-async-results),
[impossible states](https://foldkit.dev/patterns/anti-patterns#make-impossible-states-unrepresentable),
[submodel boundaries](https://foldkit.dev/patterns/anti-patterns#preserve-submodel-boundaries),
[live handles](https://foldkit.dev/patterns/anti-patterns#keep-live-handles-behind-runtime-boundaries),
[purity](https://foldkit.dev/best-practices/side-effects-and-purity),
[message names](https://foldkit.dev/best-practices/messages),
[testing](https://foldkit.dev/testing).

## Summary

- The pages follow the architecture well overall: Messages are past-tense facts (no imperatives, no
  `NoOp`), Commands are verb-first, effects live in Commands / Mounts / Subscriptions, Subscriptions
  are gated on Model or `Shared` slices, Models are Schema-typed with branded ids, there is no
  `switch`, no `try/catch`, and only one module-level `let` (`home/dm.ts`).
- The dominant bug class is **missing in-flight guards in `update`**: handlers rely on the view
  disabling a button (about 20 handlers across 14 pages), so Enter, a double click or a re-render race sends the RPC twice. The Story
  tests now document these with `test.fails`.
- The second class is **stale async results**: list reloads and lookups whose result Messages carry
  no generation or org, so an older response can win.
- Consistency gaps: three toast helper modules, two failure-Message shapes, internal hrefs built from
  template strings (no typed route builder is exported), and loading / failure states hidden inside
  empty lists on about half the pages.
- Tooling: the `@foldkit/oxlint-plugin` rules are **not active**. The root `.oxlintrc.json` has no
  `foldkit` entry and `apps/web-foldkit` has no lint config. Several findings below (module `let`,
  parent constructing child Messages, manual child folds) are exactly what the plugin flags.

Tests: 57 Story / Scene files in scope now (before: 21, mostly plain vitest calls on `update`).
389 tests, 366 passing and 23 `test.fails` documenting real bugs. See "Tests" at the end.

## Top findings (bugs, ranked)

Each is backed by a failing-by-design test where noted (`test.fails`, the test name says what breaks).

1. **Channel integrations: a delete can get stuck forever after closing the confirm dialog.**
   `page/channel-settings/integrations/update.ts:119-133, 182-199`. Closing the dialog while a delete
   runs sets `confirmTarget` to null; `settleRowAction` only clears `isConfirmPending` when
   `confirmTarget?.id === id`, so `isConfirmPending` stays true and every later `ClickedConfirmRemove`
   is ignored. Rule: [impossible states](https://foldkit.dev/patterns/anti-patterns#make-impossible-states-unrepresentable).
   Fix now: clear `isConfirmPending` unconditionally on settle. Design: one
   `confirm: Closed | Confirming{target} | Removing{target}` union.
   Test: `channel-settings/integrations/story.test.ts` (`test.fails`).
2. **Onboarding: Enter twice on the profile step sends two profile updates and skips the timezone step.**
   `page/onboarding/update.ts:119-133`. `SubmittedProfile` has no `isSubmitting` guard and
   `SucceededUpdateProfile` advances without a step guard, so the second success advances from
   timezone to theme. Same missing guard on `ClickedContinueTimezone` (`:180`) and
   `ClickedContinueInvite` (`:258`, invites everyone twice). Fix now: return `{ model }` while
   submitting and wrap the success handlers in `withForm(<step>)`.
   Tests: `onboarding/story.test.ts` (3 `test.fails`).
3. **Onboarding invites are sent twice.** `SucceededSendInvites` (`onboarding/update.ts:277-290`)
   passes the same emails to `finalize`, and `CompleteOnboarding` (`onboarding/command.ts:105`)
   invites them again. Inherited from legacy. Fix now: pass `emails: []` once the invite step sent
   them. Test: `onboarding/story.test.ts` (`test.fails`).
4. **Onboarding invite errors land on the wrong row.** Errors are keyed by position among filled
   rows (`onboarding/update.ts:262-268`) but read by row index (`steps/invite.ts:25`), and removing a
   row does not re-key them (`update.ts:247-256`). Fix now: key errors by row index.
   Test: `onboarding/story.test.ts` (`test.fails`).
5. **Brand color swatches cannot be clicked** (my-settings appearance, onboarding theme).
   `ui/aria-radio.ts:45, 81` builds the selector `#brand-color-#099250` from the value, which is an
   invalid selector, so `document.querySelector` throws before the Message is sent. The code lives in
   the UI kit (owned by the kit review) but breaks these pages. Fix: `CSS.escape(id)` or strip `#`.
   Test: `my-settings/appearance/scene.test.ts` (`test.fails`).
6. **Team page "Invite user" button does nothing.** `page/settings/team/view.ts:170` has no
   `onPress`; the row "Actions" button (`:112-124`) is dead too with `aria-expanded` hard-coded.
   Fix: `ClickedInviteUser` sending `RequestedModal({ _tag: "EmailInvite" })` as invitations does.
   Test: `settings/team/scene.test.ts` (`test.fails`).
7. **Integration detail sticks on "Verifying connection..." after an OAuth success then disconnect.**
   `page/settings/integrations/detail/update.ts:69` sets `pendingVerification` and nothing clears it;
   `view.ts:116` shows the verifying state whenever the connection is inactive. Fix now: clear it in
   `UpdatedConnection` once the connection is active.
8. **Stale list overwrites.** Result Messages without a generation or org:
   - `settings/connect-invites`: `SucceededListInvites` (`message.ts:9`, `update.ts:158`) has no
     `organizationId`, so after an org switch or overlapping accept / decline refetches an older list
     wins. Fix: carry the org and compare with `requestedFor`, as chat-sync already does.
   - `settings/chat-sync-connection`: `reloadLinks` (`update.ts:89-92`) refetches after every
     create / remove / update and `SucceededListChannelLinks` has no generation.
   - `channel-settings/integrations`: concurrent `ListWebhooks` / `ListRss` / `ListGitHub` reloads.
   - `my-settings/profile`: `LoadedCropImage` (`update.ts:192-195`) is accepted whenever the crop is
     `Loading`, so picking A, cancelling, then picking B can show A's image. Add a load id.
   - `my-settings/notifications` (`update.ts:79-87, 152-183`): full-snapshot writes race, a row echo
     clears all optimistic state, and an old failure wipes a newer write. See finding A1 below.
   - `settings/invitations`: initial fetch and post-revoke refetch (`update.ts:122, 127`).
   Rule: [stale results](https://foldkit.dev/patterns/anti-patterns#reject-stale-async-results).
9. **Custom emojis: picking a file while a save runs replaces the draft and the late success clears
   the new one.** `page/settings/custom-emojis/update.ts:211, 218, 259-262`; the empty state's
   "Upload emoji" button stays live during a save (`view.ts:296-303`). Fix now: guard `SelectedFiles`
   on `isSaving` and carry the draft's `previewUrl` in the result.
10. **Home: pressing Message twice can create two DMs.** `page/home/update.ts:42-48, 106-115` has no
    pending state across `FindDm` then `CreateDm`, and `FindDm` uses `Effect.promise`
    (`commands.ts:35`) so a rejection is a defect with no failure Message. Fix now:
    `pendingDmUserId: Option<UserId>` plus `FailedFindDm`. Test: `home/story.test.ts` (`test.fails`).
11. **Pages that stay blank when Clerk fails to mount.** `FailedMountClerkComponent` is ignored by
    `auth/index.ts:19`, `onboarding/setup-organization/index.ts:34` and `select-organization/update.ts:34`.
    If Clerk is not loaded when the element mounts nothing retries. Fix: wait for `Clerk.loaded` in a
    `Mount.defineStream`, or show the loader while `shared.auth === "Loading"`.
12. **Onboarding finalize failure leaves the spinner running** next to the error with no retry
    (`onboarding/update.ts:309-311`, `view.ts:64-73`). Inherited. Design: a retry Message.
13. **Select organization "Create a new one" loops back.** `select-organization/update.ts:33` sends an
    onboarded user to `/onboarding`, which redirects onboarded users to `/`. Inherited. Fix now:
    navigate to `/onboarding/setup-organization`.

## Fix now, low risk

Grouped by kind. Each is a page-local change that does not touch the contract.

### F1. In-flight guards in `update` (bug risk)

The view disables the button, but `update` accepts the Message again, so Enter in a form, a fast
double click, or a keyboard path reaches the Command twice. Return `{ model }` when the pending flag
or id is already set. `test.fails` tests exist for the starred ones.

| Page | Handler | Pending state to check |
| --- | --- | --- |
| settings/general | `ToggledPublicMode` (`update.ts:236`), `SelectedLogo` (`:225`), `ClickedConfirmDelete` (`:256`) | `isTogglingPublic`, `isUploading`, `isDeleting` |
| settings/connect-invites* | `ClickedAccept` / `ClickedDecline` (`update.ts:163, 181`) | id in `acceptingIds` / `decliningIds` |
| settings/integrations/installed* | `ClickedUninstall` (`update.ts:45`) | add `uninstallingBotIds` (none today) |
| settings/integrations/marketplace* | `ClickedInstall` (`update.ts:72`) | `installingBotIds` |
| settings/integrations/detail* | `ClickedConnect` (`:104`), `ClickedDisconnect` (`:123`), `SubmittedApiKeyForm` (`:135`) | `isConnecting`, `isDisconnecting` |
| settings/chat-sync-connection | pause / resume / direction (`update.ts:140`) | per-link pending id |
| my-settings/profile* | `ClickedResetAvatar` (`update.ts:247`) | `isResetting` |
| my-settings/linked-accounts* | `ClickedLinkDiscord` (`:69`), `ClickedUnlinkDiscord` (`:81`) | `isConnecting`, `isDisconnecting` |
| my-settings/appearance | `ClickedGenerate` | `isGenerating` |
| my-settings/desktop | `ToggledAutostart` (no pending state, failure re-reads silently, `update.ts:48`) | requested value or version |
| channel-settings/integrations* | `ClickedToggleProvider` (`update-cards.ts:107`), `ClickedDeleteProvider` (`:119`) | add `isToggling`, check `isDeleting` |
| channel-settings/connect | `ClickedDisconnect` (`update.ts:93`) does not check `roles.canDisconnect` | role check, not only the hidden button |
| onboarding* | `SubmittedProfile`, `ClickedContinueTimezone`, `ClickedContinueInvite` | `isSubmitting` / `isLoading` plus `withForm` |
| join* | `ClickedJoin` (`join/update.ts:22`) | `isJoining` |
| home* | `PressedMessageMember` | new `pendingDmUserId` |

### F2. Toast plus navigation split across two updates (architecture)

README: "Navigation and a toast together: `RequestedNavigation`'s `toast`". These pages add a no-op
relay Command only to get a second `update` for the second OutMessage, which costs a Message pair, a
render, and a window where another Message lands between the two:

- `settings/general/update.ts:83-87, 263-275` (`LeaveDeletedWorkspace`)
- `settings/chat-sync-connection/command.ts:148-151`, `update.ts:286-297` (`ScheduleReturnToList`)
- `settings/integrations/detail/command.ts:13-17`, `update.ts:65-95` (`AcknowledgeOAuthCallback`)
- `my-settings/linked-accounts/command.ts:12` (`ShowLinkResult`)
- `join/command.ts:77-81`: worse, `NavigateToWorkspace` calls `pushUrl` itself, bypassing the root
  that owns navigation.

Fix: return `PageOutMessage.RequestedNavigation({ href, replace, toast })` from the success handler
and delete the relay Command and Message. `home` already does this correctly.

### F3. Impure `init` / `update` / `view` ([purity](https://foldkit.dev/best-practices/side-effects-and-purity))

- `settings/general/update.ts:155`: `init` reads `window.location.origin`. Pass it via `Shared` or a
  flag (the root reads it once).
- `my-settings/profile/update.ts:57`: `formFor` calls `detectBrowserTimezone()` (reads `Intl`) from
  `init`, `sharedChanged` and `update`. Use a Command at init (onboarding already has
  `ReadBrowserTimezone`).
- `onboarding/timezone/view.ts:25, 75, 90`: `cityFor` / `filterCities` reach
  `getTimezoneOffsetNumber`, which does `new Date()`, and build up to 30 `Intl.DateTimeFormat` per
  render. Pass `shared.nowMs`; memoize the list with `createLazy`.
- `toLocaleDateString` / `toLocaleString` in views depend on the host locale and timezone:
  `channel-settings/connect/view.ts:129`, `settings/invitations/view.ts:16`,
  `settings/connect-invites/view.ts:41`, `settings/chat-sync/view.ts:164`,
  `settings/chat-sync-connection/connection-card.ts:154`, `settings/integrations/shared/bot-card.ts:263`.
- `settings/format-distance.ts:44`: `nowMs = Date.now()` default. Every caller passes `nowMs`; make it
  required.
- `settings/integrations/index/view.ts:153` fills a `Map` in a `for` loop inside the view; build it
  with `Array.reduce` or derive it once.

### F4. Module-level state and live handles ([live handles](https://foldkit.dev/patterns/anti-patterns#keep-live-handles-behind-runtime-boundaries))

- `home/dm.ts:28`: `let dmChannels` is a lazily created live query collection that syncs forever and
  is never released; `:32` casts `as unknown as ReadonlyArray<DmRow>`. Fix (design): a
  `liveQueryStream` subscription keeping DM rows in the Model, or a ManagedResource gated on
  `shared.organization`.
- `settings/invitations/clerk.ts:34`: a module-level `Map` caches Clerk invitation handles across
  orgs and page instances; revoke only works after a fetch in the same module instance. Fix now:
  look the invitation up inside `revokeInvitation`'s own Effect.

### F5. Parents reaching into child Submodels ([submodel boundaries](https://foldkit.dev/patterns/anti-patterns#preserve-submodel-boundaries))

- Constructing internal child Messages: `settings/general/update.ts:255` (`Modal.Message.ClickedClose()`,
  use `Modal.close`), `my-settings/appearance/update.ts:86` and
  `channel-settings/overview/update.ts:63-64` (`Interaction.Message.LeftTarget` / `BlurredTarget`; use
  the existing `Interaction.disabledTargets`).
- `channel-settings/connect/update.ts:127` reads the share modal's internal
  `SucceededCreateInvite`, and `share-modal.ts:133, 207, 211` emits `PageOutMessage` directly. Design:
  give `ShareModal` its own OutMessage union folded with `foldOutMessage`.
- Hand-rolled folds that keep only `.model` (latent: the children return no Commands today):
  `settings/general/update.ts:189-201`, `settings/custom-emojis/update.ts:181-194`,
  `settings/chat-sync/update.ts:132-140, 194-205`, `settings/chat-sync-connection/update.ts:113-126, 190-197`,
  `onboarding/update.ts:210-221, 317-321`, `home/update.ts:50-76, 95-99`. `Modal.open(...).model`
  drops Commands the same way. Use `Update.foldChild` (chat-sync already does for its menus).

### F6. Smaller conventions

- Inline casts: `my-settings/notifications/update.ts:171` (`patch as Partial<User.UserSettings>`
  casts a sliced string to the branded `TimeString`; decode it instead), `auth/clerk-mount.ts:37`
  (`as Fn`), `home/dm.ts:32`.
- `Effect.promise` turns rejections into defects (the Command dies, the spinner stays):
  `onboarding/command.ts:74, 106`, `home/commands.ts:35`, `settings/upload.ts:56`. Use
  `Effect.tryPromise` mapped to a typed failure Message.
- Unbranded ids: `settings/team/model.ts:4-5`, channel integrations row ids and connect mount / invite
  ids (`Schema.String` where `@hazel/schema` brands exist).
- Command result names that do not pair with their Command
  ([message names](https://foldkit.dev/best-practices/messages)): e.g. `RevokeInvitation` to
  `SucceededRevoke`, `SaveCustomEmoji` to `SucceededCreateEmoji`, `IntegrationDisconnect` to
  `CompletedDisconnect{ toast | null }` (a fallible Command should resolve to `Succeeded` / `Failed`),
  profile `SaveProfile` / `UploadAvatar` / `ResetAvatar` to `Completed*{ isX }`, `CheckAutostart` to
  `CheckedAutostart`. `"ListConnections"` is defined twice (`settings/chat-sync/update.ts:31`,
  `settings/chat-sync-connection/command.ts:24`), ambiguous in DevTools.
- `join/command.ts:25` maps every lookup failure to `SucceededFetchOrganization({ organization: null })`,
  so a network error reads as "Workspace Not Found". Add `FailedFetchOrganization`.
- `onboarding/model.ts:73` `isProcessing` is written but never read; delete it.
- `onboarding/timezone/globe.ts:57-80` `TwinkleStar` starts an infinite animation with no release;
  wrap it in `acquireRelease` and cancel.
- `onboarding/update.ts:300-307` returns `ReplaceStepUrl` and `LoadHome` together with no ordering.
- `HoveredOffset({ offset: null })` doubles as mouse-leave (`timezone/city-card.ts:34`, `ribbon.ts:38`).
- `home/commands.ts:60` orphaned doc comment; `my-settings/profile/message.ts:20` `RejectedAvatarFile`
  is never dispatched; `settings/custom-emojis/message.ts:24` `FailedCreateEmoji.toast` is `NullOr`
  but never null.
- Silent failures with no toast or state: `notifications/inbox/update.ts:66`
  (`FailedMarkNotificationRead`), `settings/connect-invites/update.ts:159` (`FailedListInvites` shows
  the empty state), `channel-settings/connect/update.ts:70` (`FailedListOutgoingInvites`),
  `my-settings/profile/update.ts:233` (crop returns a null blob), `my-settings/desktop/update.ts:48`.

## Needs a design change

### D1. Typed route builders (architecture)

`src/route.ts` keeps its routers in a non-exported `orgRouters` array, so no page can build a URL
from a route value. Every internal href is a template string: `settings/chat-sync/update.ts:241, 295`,
`settings/chat-sync-connection/update.ts:222`, `settings/integrations/{index,installed,detail}`,
`settings/debug/index.ts:26`, `my-settings/linked-accounts/update.ts:62`,
`channel-settings/redirect/index.ts:20`, `channel-settings/integrations/update.ts:166`,
`onboarding/update.ts:306`, `join/command.ts:72, 80`, `select-organization/update.ts:10-13`,
`home/update.ts:27, 119`, `profile/view.ts:62`, `notifications/inbox/view.ts:130`.
Bug risk inside it: several use `shared.orgSlug ?? ""`, which yields `//settings/...` or `//chat/<id>`,
a protocol-relative URL, when the slug is null. Short term (fix now): read `orgSlug` from the route
stored in the Model, as the integrations pages already do. Long term: export the routers or one
`hrefOf(route: AppRoute)` and use it everywhere. Buttons that only navigate (`ClickedConnection`,
`ClickedIntegration`, `ClickedBack`) could be plain `<a href>` per the README.

### D2. One toast helper and one failure-Message shape (consistency)

Three helper sets produce different copy for the same error:

- `data/actions.ts` (`failureToast(cause, byTag)`, falls back to `getUserFriendlyError`): general,
  custom-emojis, invitations, connect-invites, home.
- `ui/toast-exit.ts` (same names, different signature and fallback): chat-sync, chat-sync-connection,
  all channel-settings pages.
- `settings/integrations/shared/exit-toast.ts`: the integrations pages.
- my-settings uses none: local `toast()` helpers and every Command swallows the cause with
  `Effect.catch(() => false)`, so tagged errors never reach the toast.

Failure Messages are `{ toast: ToastRequest }` in some pages and `{ title, description }` in others.
Several pages hard-code `errorToast` and drop the cause (`settings/custom-emojis/update.ts:133, 145,
299, 315`, `settings/invitations/update.ts:128`, `settings/general/update.ts:109-114`). Settle on
`data/actions` and `{ toast }` everywhere.

### D3. Optimistic mutations through `data/actions` (contract)

README: optimistic mutations run the legacy atoms with `runAtomFn` and `settle`. Only general and
custom-emojis do. my-settings profile and notifications call the plain RPC through
`my-settings/user.ts:18` (`updateUser`), and notifications rebuilds its own optimistic layer
(`optimisticSettings`), which is where the lost-update race in finding 8 comes from. Use
`runAtomFn(updateUserAction, ...)` and delete `optimisticSettings`; the collection's own optimistic
row already arrives through `userRowStream`.

### D4. Loading and failure states ([impossible states](https://foldkit.dev/patterns/anti-patterns#make-impossible-states-unrepresentable))

Good pattern exists: chat-sync's `Connections` union (`Loading | Failed | Loaded`), and `NullOr` for
loading in custom-emojis / installed / marketplace / your-apps. Pages that hide loading or failure
inside an empty list: invitations (`clerk.ts:61` `orElseSucceed([])`), connect-invites,
team (`members: []` shows "0 users" while loading), integrations index, chat-sync-connection
(`FailedListChannelLinks` becomes `Loaded []`, then reads as "connection not found"), channel connect
invites, and profile (`profile/model.ts:17`, `null` means both loading and not found, so "User not
found" flashes). Foldkit ships `AsyncData`; none of these pages use it. Adopt it or one shared
remote-data Schema.

Related impossible states: a `deleteTarget` plus `xModal.isOpen` kept in sync by hand
(`settings/custom-emojis/model.ts:42-45`, `settings/chat-sync/model.ts:46-48`,
`settings/chat-sync-connection/model.ts:63-67`; an open modal with a null target renders "delete ::"),
`ProviderCard`'s `isCreating` / `isDeleting` / `confirmDelete` booleans, and onboarding's
`isInitialized` + `browserTimezone: UndefinedOr` + `membership: UndefinedOr(NullOr)`.

### D5. Clerk as a Resource

Onboarding (`onboarding/clerk.ts`), auth, invitations and profile call `window.Clerk` directly inside
Commands and Mounts. A Clerk Resource in `rpc.ts` would make those Commands testable and give one
place to wait for `Clerk.loaded` (finding 11).

### D6. Lint plugin

Wire `@foldkit/oxlint-plugin` (its `recommended.json`) into the root `.oxlintrc.json` for
`apps/web-foldkit`. It catches module-level `let`, parent-built child Messages, manual child folds,
`Mount`s that ignore their element and hard-coded route strings continuously; this review is a
snapshot.

## Accessibility (found by Scene locators)

Scene locates by role, label and text, so a control the tests could only reach by CSS selector or
position is a missing name or role. The migration plan (section 9) says the same about parity
scenarios.

- **Icon `<title>`s leak into accessible names app-wide.** `icons/index.ts:41` renders a default SVG
  `<title>` that is not `aria-hidden`; the chat-sync "Delete connection" icon button is announced as
  "badge 13". Make decorative icons `aria-hidden` and give icon-only buttons an `aria-label`. (Icons
  are kit-owned; listed here because every page inherits it.)
- Icon-only buttons with no name: home "Message" (`home/view.ts:161-174`, `test.fails` in
  `home/scene.test.ts`), invitations row menu (`settings/invitations/view.ts:38`), custom emoji trash
  (`settings/custom-emojis/view.ts:268-276`), channel overview clear-icon (`overview/view.ts:45`),
  share modal clear-workspace (`connect/share-modal-view.ts:73`), channel integrations row menu
  (`row-menu.ts:42`), copy buttons (`webhooks.ts:87`, `token-display.ts:29`, `provider-card.ts:112`),
  URL info (`provider-card.ts:262`).
- Unlabelled inputs: marketplace search (placeholder only, `marketplace/view.ts:55`), profile page
  email (`profile/view.ts:122-131`, the heading is an `h3` not a label), avatar file input, channel
  provider read-only URL inputs, integration config switches (`detail/view-connection.ts:231`),
  onboarding profile form (no accessible name).
- Selected state only visual: integration category filters (`integrations/index/view.ts:193`) and
  sync-direction buttons (`chat-sync-connection/add-link-view.ts:182`) need `aria-pressed`.
- Invalid nesting: button in button (`settings/integrations/shared/bot-card.ts:126, 141`), button in
  link (`join/view.ts:121`); a hidden "DropZone" button with `aria-labelledby=""`
  (`custom-emojis/view.ts:58-64`, profile avatar drop zone).
- Clickable `div` with no role: read inbox rows (`notifications/inbox/view.ts:83`).
- Loading spinner with no role (`channel-settings/integrations/cards.ts:18`); use `loader(h)`.
- Destructive actions with no confirm dialog (parity with legacy, but worth a decision): Unlink
  Discord, integration Disconnect, channel connect Disconnect.

## Already good

- Messages are facts, Commands are imperatives; no `NoOp`, no `switch`, no `try/catch`.
- Effects live in Commands, Mounts and Subscriptions; Mounts use their element and release
  (`auth/clerk-mount.ts` pairs mount with unmount through `acquireRelease`).
- Subscriptions are gated on Model / `Shared` slices and return `Stream.empty` until their
  dependencies exist; `cropDrag` only listens during a drag.
- `Shared` is never copied into a Model; `sharedChanged` recomputes derived state.
- Stale-result handling done right in places: chat-sync org-tagged lists, connect invites by org,
  share-modal search versioned debounce, provider "Confirm?" `confirmVersion`, onboarding timezone
  debounce carrying its query.
- Tagged unions where they matter: profile `CropState`, onboarding `StepForm` with `withForm`.
- Home's DM flow uses one toast id across loading, success and error and rides the success toast on
  `RequestedNavigation`, exactly as the README describes.
- Delete workspace requires the exact name; overview, profile, create-webhook and share-modal submits
  are guarded against double submit.

## Tests

Every page in scope now has a Story test (`story.test.ts`, drives `update` with `foldkit/story`) and
a Scene test (`scene.test.ts`, drives the view with `foldkit/scene`), colocated and named per
[testing](https://foldkit.dev/testing). Existing story-style files were renamed with `git mv`
(`page.test.ts` / `update.test.ts` to `story.test.ts`, or `scene.test.ts` where they already drove
the view). Three plain vitest files were left as they are (`invitations/page.test.ts`,
`linked-accounts/linked-accounts.test.ts`, `notifications/inbox/page.test.ts`).
Team has only a Scene test: its `update` handles one live-query Message.

Run (only these files): 54 files, 389 tests, 366 passing, 23 `test.fails` (the table omits the 13 tests in the three plain vitest files). `tsc --noEmit` is clean.

| Area | Story tests | Scene tests | `test.fails` |
| --- | --- | --- | --- |
| settings/general | 10 | 9 | 0 |
| settings/invitations, team, custom-emojis, connect-invites | 33 | 16 | 2 |
| settings/chat-sync, chat-sync-connection | 21 | 20 | 0 |
| settings/integrations (index, installed, marketplace, your-apps, detail) | 18 | 29 | 6 |
| my-settings (profile, appearance, notifications, linked-accounts, desktop) | 43 | 24 | 4 |
| channel-settings (overview, integrations, connect) | 47 | 21 | 2 |
| onboarding (incl. setup organization) | 26 | 14 | 6 |
| home, inbox, join, select-organization, profile, auth | 24 | 21 | 3 |

What they cover: form validation and submit (general rename, profile, overview, onboarding profile and
invites, create webhook, API key), RPC Command wiring with `Command.resolve` for both success and
failure Messages, the OutMessages each step emits (`RequestedToast`, `RequestedNavigation`,
`RequestedModal`, `RequestedTheme`, `RequestedSoundSettings`, `RequestedCurrentUserRefresh`),
destructive dialogs end to end (delete workspace, delete connection, disconnect, remove link,
delete emoji, uninstall, revoke), permission-gated controls, and live-query results through
`Scene.Subscription.emit`.

Helpers (additive, `src/test/`):

- `pages-fixtures.ts`: `makeShared` (signed-in owner of "Hazel Labs", override any field),
  `memberWithRole`, branded `organizationId` / `memberId` / `userId` / `channelId`, `uuid`,
  `storyUpdate(update, shared)`, `pageScene(update, view, shared)` (wraps `withViewInputs`),
  `portalModalMounted` (the `ui/modal` overlay Mount), `failureToastFixture`.
- Area helpers: `pages-integrations-fixtures.ts`, `pages-channel-settings-fixtures.ts`,
  `pages-entry-fixtures.ts`.

Source changes are additive `export`s only, so tests can name Commands and Mounts: general
(`UpdateOrganizationName`, `SetPublicMode`, `CopyText`, `OpenLogoPicker`, `LeaveDeletedWorkspace`,
`UploadLogo`, `DeleteOrganization`), invitations (`FetchInvitations`, `RevokeInvitation`),
connect-invites (`ListIncomingInvites`, `DeclineInvite`), custom-emojis (`OpenPicker`,
`CreatePreview`, `FocusName`, `RevokePreview`, `SaveEmoji`, `RestoreEmoji`), auth
(`MountClerkComponent`, `init`, `update`, `signInView`, `signUpView`), setup-organization (`view`),
join (`CardEnterAnimation`).

Notes for whoever writes the next page test:

- A Command instance whose args hold a jsdom `File` or `Blob` cannot be compared structurally (it
  throws inside the equality hash after about 5 s). Match those Commands by Definition and check the
  args separately.
- A Mount wrapped with `Mount.mapMessage` (controlled modals, Clerk mounts) is not re-wrapped by
  `Scene.Mount.resolve`: pass the parent Message, and use a name-only matcher
  (`{ name: "PortalModal" }`) so it typechecks. `portalModalMounted` only fits Submodel modals.
- `story(storyUpdate(update, shared), ...)` sometimes infers `Model` as `unknown` when a step's types
  do not line up; pass the type arguments explicitly (`story<Model, Message, PageOutMessage>(...)`).
- Importing anything that pulls in `ui/aria/interaction.ts` needs jsdom: `:204` touches `document`
  at module load. Making it lazy would let pure Story tests run in node.
- `Scene.role("switch", { name })` does not resolve a name from a wrapping `<label>`; use
  `Scene.label(...)` or `Scene.role("switch")`.
