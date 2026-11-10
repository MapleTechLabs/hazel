# Customers pages

The Customers area (`docs/customers/tech-design.md` §6). Read `src/page/README.md` first: every page
here is an ordinary page (`definePage`), registered in `src/page/registry.ts`.

## Routes (`src/route.ts`)

| Route tag                     | URL (`/$orgSlug/customers…`)      | Fields                                  | Page module           |
| ----------------------------- | --------------------------------- | --------------------------------------- | --------------------- |
| `CustomersOverview`           | ``                                |                                         | `overview/`           |
| `CustomersAttention`          | `/attention`                      |                                         | `attention/`          |
| `CustomersList`               | `/list?view=`                     | `view: Option<string>`                  | `list/`               |
| `CustomerDetail`              | `/$accountId?tab=`                | `accountId`, `tab: Option<CustomerTab>` | `detail/`             |
| `CustomersSettingsSignals`    | `/settings/signals`               |                                         | `settings/signals/`   |
| `CustomersSettingsSignalNew`  | `/settings/signals/new?template=` | `template: Option<SignalTemplate>`      | `settings/signals/`   |
| `CustomersSettingsSignalRule` | `/settings/signals/$ruleId`       | `ruleId`                                | `settings/signals/`   |
| `CustomersSettingsHealth`     | `/settings/health`                |                                         | `settings/health/`    |
| `CustomersSettingsSources`    | `/settings/sources`               |                                         | `settings/sources/`   |
| `CustomersSourceDetail`       | `/settings/sources/$provider`     | `provider: CustomerProvider`            | `settings/sources/`   |
| `CustomersUnmatched`          | `/settings/sources/unmatched`     |                                         | `settings/unmatched/` |

- `view` is a built-in view's key (`BuiltInViewKey`: `my_customers`, `paying`, `trialing`, `at_risk`,
  `churned`) or a saved view's id; the sidebar links built-ins by key, so they work before views sync.
- `CustomerTab` = `overview | users | billing | activity | notes` (none = overview).
- Helpers: `customersListRoute(orgSlug, view?)`, `customerRoute(orgSlug, accountId, tab?)`;
  `isCustomersRoute`, `isCustomersSettingsRoute`. Links are `h.Href(hrefOf(route))`; navigation from
  `update` is `requestedOrgNavigation(shared.orgSlug, (orgSlug) => customerRoute(orgSlug, id))`.
- `orgSectionOf` is `"Customers"` for all of them: the shell shows the Customers sidebar
  (`src/shell/customers-sidebar.ts`) and wraps the page in a full-height `main` with
  `overflow-hidden`. **A page scrolls itself** (`h-full overflow-y-auto` on its root).

## Adding / replacing a page

The pages not built yet are placeholders (`placeholder.ts`) already registered under their final id
and routes. To build one, replace its `index.ts` with a real `definePage` **with the same id** (e.g.
`"CustomersList"`) and routes; the registry needs no change. Key choices already made:
`CustomersList` is keyed by org (view changes arrive as `routeChanged`), `CustomerDetail` by
`accountId` (tab changes arrive as `routeChanged`). Ask agent c to split a page's routes into
separate pages or add routes (`route.ts`, `registry.ts` and `route.test.ts` are c's).

## Live data: `src/customers/queries.ts`

Synced rows become plain page rows (dates as epoch ms), the same shape the lab fixtures convert to:

- `AccountRow`, `toAccountRow(account)`; `SignalRow`, `toSignalRow(signal)`; `SavedViewRow`.
- Streams for a Subscription `entry` (each opens the org's customers source first):
    - `accountsStream(orgId, toMessage)`: live accounts by name.
    - `signalsStream(orgId, toMessage)`: every synced signal (unclosed + closed ≤ 30 d), priority desc.
    - `myOpenSignalCountStream(orgId, userId, toMessage)`: the sidebar badge.
    - `savedViewsStream(orgId, userId, toMessage)`: shared + mine, by position.
    - `connectedProvidersStream(orgId, toMessage)`: providers not disconnected.
    - `settingsSummaryStream(orgId, toMessage)`: `{ lastComputedAtMs, bands, reportingCurrency }` or null.
    - `orgMembersStream(orgId, toMessage)`: `MemberRow`s (owners, assignees); from the org source.
- Helpers: `accountsByIdOf`, `isOnMyAccount` ("Mine" = signals on accounts I own), `queueTabOf`,
  `msOf`, `withCustomersSource(orgId, stream)` for a query of your own over the customer collections
  (`src/core/db/collections.ts`: `customerNoteCollection`, `customerSignalRuleCollection`,
  `customerSettingsCollection`, `customerMetricDefinitionCollection`, `customerConnectionCollection`,
  `customerSyncRunCollection`).

```ts
accounts: entry(
	{ organizationId: Schema.NullOr(OrganizationId) },
	{
		modelToDependencies: ({ shared }) => ({ organizationId: shared.organization?.id ?? null }),
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: accountsStream(organizationId, (accounts) => Message.UpdatedAccounts({ accounts })),
	},
),
```

Aggregates and series are RPCs (`HazelRpc.use((rpc) => rpc("customers.account.detail", …))`) stored
as `AsyncData` in the page Model.

## Mutations: `src/customers/actions.ts`

Optimistic: change the collections now, run the RPC, await the `customers:<org>` transaction, roll
back on failure. Call them from a Command, then `Effect.catchTags` for the RPC's errors and
`catchCommon` (`docs/foldkit-decisions/s6-errors.md`):

| Action                     | Props (all take `organizationId`)                                        |
| -------------------------- | ------------------------------------------------------------------------ |
| `assignSignalAction`       | `signalId`, `assigneeUserId \| null`                                     |
| `snoozeSignalAction`       | `signalId`, `userId`, `until: Date`, `note?`                             |
| `markSignalDoneAction`     | `signalId`, `userId`, `outcome: SignalOutcome`, `note?`                  |
| `dismissSignalAction`      | `signalId`, `userId`, `reason?`                                          |
| `reopenSignalAction`       | `signalId`                                                               |
| `createNoteAction`         | `accountId`, `authorUserId`, `body`, `pinned?`, `signalId?`              |
| `updateNoteAction`         | `noteId`, `body?`, `pinned?`                                             |
| `deleteNoteAction`         | `noteId`                                                                 |
| `updateAccountAction`      | `accountId`, `ownerUserId?`, `tags?`, `lifecycleStageOverride?`, `name?` |
| `bulkUpdateAccountsAction` | `accountIds`, `ownerUserId?`, `addTags?`, `removeTags?`                  |

```ts
const AssignSignal = Command.define("AssignSignal", {
	args: {
		organizationId: OrganizationId,
		signalId: CustomerSignalId,
		assigneeUserId: Schema.NullOr(UserId),
	},
	messages: [Message.SucceededAssignSignal, Message.FailedAssignSignal],
	execute: (args) =>
		assignSignalAction(args).pipe(
			Effect.as(Message.SucceededAssignSignal()),
			Effect.catchTags({
				CustomersNotFoundError: () =>
					Effect.succeed(Message.FailedAssignSignal({ reason: "NotFound" })),
				CustomerSignalTransitionError: () =>
					Effect.succeed(Message.FailedAssignSignal({ reason: "Stale" })),
			}),
			catchCommon((reason) => Message.FailedAssignSignal({ reason })),
		),
})
```

`attention/commands.ts` has the queue's Commands built this way; reuse them where they fit.
Timestamps and the new note's id are taken when the action runs (`Clock`), so callers never pass
them. A Command's name must match its const (`foldkit/command-binding-matches-name`) and be unique
app-wide.

## Lab

Page entries live in `src/lab/entries/customers/pages/<page>.ts` (every file there is a lab page).
`attention.ts` and `overview.ts` show the pattern: the real `update`/`view` over
`src/lab/fixtures/customers.ts` rows (`toAccountRow`, `toSignalRow`), `labShared` from
`./lab-shared.ts` as `Shared`, Commands dropped and RPC answers filled from fixtures in the lab's
own `update`.
