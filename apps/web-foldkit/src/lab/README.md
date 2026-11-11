# Lab

`/lab/<path>` boots one Foldkit program over fixtures instead of the app: no session, no backend.
On in dev (`bun run dev` → `http://localhost:3100/lab`) and wherever `VITE_HAZEL_LAB=on`. `/lab` lists
every page. `?theme=dark|light` overrides the system theme; each page's switches (`?state=` …) are
links in its header.

## Adding a page (c/d: customers pages)

1. Add `src/lab/entries/customers/pages/<name>.ts` exporting `lab`. That's the registration: it is
   served at `/lab/customers/pages/<name>` and listed on `/lab` (registry = the glob, `registry.ts`).
2. Mount the real page: its `Model`, `update`, `view`, a fixture model, and a `?state=` switch:

```ts
import { Effect, Schema } from "effect"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import { overviewFixture } from "../../../fixtures/customers"
import * as Page from "../../../../page/customers/overview" // your page

const STATES = ["default", "partial", "empty", "12m"] as const

export const lab = defineLabWithFlags("Customers overview", {
	Model: Page.Model,
	Flags: Schema.Struct({ state: Schema.Literals(STATES) }),
	flags: Effect.all({ state: queryParam("state", STATES, "default") }),
	init: ({ state }) => ({ model: Page.modelOf(fixtureFor(state)) }), // AsyncData already settled
	update: (model, message) => ({ ...Page.update(model, message), commands: [] }), // stub the RPCs
	view: (model, h) =>
		labPage(
			h,
			{ title: "Overview", switches: [{ name: "state", values: STATES, current: model.state }] },
			[Page.view(model, h)],
		),
})
```

- Commands run with the app's Resources; drop the ones that would reach the network (as above),
  or keep the ones that are local (focus, scroll).
- A page that renders inside the shell: render just the page body; the lab has no shell yet.

3. Optional: a one-line description on `/lab` — ask the kit owner to add it to `LAB_DESCRIPTIONS`
   (`registry.test.ts` fails on a description for a path with no entry).

Helpers: `defineLab` (no flags), `defineLabWithFlags`, `defineStaticLab` (a view; buttons send
`ignored`), `queryParam`, and the chrome in `frame.ts` (`labPage`, `labSection`, `labRow`).

## Fixtures — `fixtures/customers.ts`

Fixed `NOW` (Tue 10 Nov 2026 12:00 UTC). `ACCOUNTS` (214, $48,210 MRR, health split 142/41/18/13),
`ACCOUNTS_BY_KEY.<acme|northwind|kestrel|brightfield|halcyon|oakridge|consolidated|pinecone|…>`,
`SIGNALS` / `OPEN_SIGNALS` (every evidence viz and status), `RULES`, `SETTINGS`, `CONNECTIONS`,
`SYNC_RUNS`, `overviewFixture(range, { partial })`, `EMPTY_OVERVIEW`, `ACME_DETAIL` (account detail),
`TEAM` / `ME` / `memberOf(userId)`, `accountOf(signal)`. `fixtures/customers.test.ts` keeps the totals
consistent.
