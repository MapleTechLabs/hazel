# Pages

Every routed screen is a Submodel that the root builds on navigation and drops on leave. The root owns
the route, the session, the shell (sidebars, menus) and the overlays (modal, command palette, toasts).
A page owns only its own state.

## Adding a page

1. Find the route tag in `src/route.ts` (all 39 legacy routes are already there).
2. Create `page/<area>/<page>/` with the files the page needs:

    | File              | Contents                                                                         |
    | ----------------- | -------------------------------------------------------------------------------- |
    | `model.ts`        | `Model` (Schema). Route params the page needs go here, set in `init`.            |
    | `message.ts`      | `Message` (`defineMessageUnion`, verb-first past-tense facts).                   |
    | `update.ts`       | `init(route, shared)` and `update(model, message, shared)`, plus its Commands.   |
    | `view.ts`         | `view = Submodel.defineView<Model, Message, PageViewInputs>(...)`.               |
    | `subscription.ts` | `Subscription.make<PageSubscriptionInput<Model>, Message>()(...)`.               |
    | `index.ts`        | `export const page = definePage("<Id>", { Model, Message }, { routes, ... })`.   |

3. Register it in `page/registry.ts`: import the module and append `X.page` to `pages`. That is the
   only shared file you touch.

`page/settings/team/` is the minimal example; `page/chat/channel/` shows a page keyed by a route param,
memoized views and a `sharedChanged` hook. `page/root/` shows a page that only redirects.

## The contract (`page/contract.ts`)

- **Route params.** `init(route, shared)` receives the route variant, typed by `routes`. Store the params
  you need in the Model. `key(route)` decides when a navigation keeps the same instance (default: the whole
  route); a kept instance gets `routeChanged(model, route, shared)` instead of a new `init`.
- **Shared data.** `Shared` holds `auth`, `orgSlug`, `currentUser`, `organization`, `member` (id and role)
  and `nowMs`. `update`, `routeChanged` and `sharedChanged` receive it, the view gets it as
  `viewInputs.shared`, and Subscriptions read it as `input.shared`. Never copy it into the Model; if
  derived state depends on it, recompute in `sharedChanged`. Permissions: `can(shared, "channel.create")`.
- **RPC.** Commands `yield* HazelRpc` (`src/rpc.ts`); it is the app's `resources` layer. Map every `Exit`
  to a Message (`SucceededX` / `FailedX`).
- **Live queries.** Use `liveQueryStream` (`src/data/live-query.ts`) with the legacy `useLiveQuery`
  builder, inside an `entry` whose dependencies come from `input.model` and `input.shared`. Return
  `Stream.empty` until the dependencies exist. Keys are prefixed with the page id automatically.
- **Toasts, modals, navigation, palette.** Return an OutMessage from `update`:
  `PageOutMessage.RequestedToast`, `RequestedModal` (one variant per legacy `useModal` id),
  `RequestedNavigation({ href, replace })`, `RequestedCommandPalette`, `RequestedSignOut`
  (`page/out-message.ts`). Plain links need nothing: an `<a href>` is followed by the app.
- **Layout.** Render only what the legacy route's own component renders (its `<Outlet />` content). The
  root wraps it in the org shell and the route's section layout (`shell/layouts.ts`): `main` for
  settings, my-settings and notifications, the column for integrations and chat sync, the channel
  settings header and tabs, the centered auth layout. Unported routes render an empty
  `[data-page-placeholder=<RouteTag>]` element in that spot.
- **Shell state** (sidebar data, menus, collapsed sections, panel widths) lives in `shell/`, not in pages.
- **Performance.** The root re-renders on every Message. Memoize expensive subtrees with `createLazy`
  and keep `toParentMessage`-style functions at module scope (see `page/chat/channel/view.ts`).

## Parity

Port the legacy class composition (`*.styles.ts`, the UI kit in `src/ui`), then run
`bun run parity build foldkit && bun run parity run --filter <scenario>` from `packages/ui-parity`.
