# Customers integrations: the boundary

Core Customers code knows no concrete tool. Everything specific to one lives in its folder in
`packages/customer-integrations/src/<id>/`, and the folder is registered in one line of
`packages/customer-integrations/src/registry.ts`.

## Goals

1. No tool is named on the core side of the boundary (enforced by `boundary.test.ts`).
2. A new integration is a new folder plus its registration in `registry.ts`.

## Layout

```
packages/customer-integrations/src/
  registry.ts        the one place integrations are registered, and the lookups derived from it
  kit/               what integrations build on: the contract, HTTP client, errors, Svix, crypto, time
  boundary.test.ts   fails when core names a registered integration
  <id>/
    index.ts         the definition: browser-safe, no server code
    config.ts        its config schema and default
    presentation.ts  what the pages say and show about it: copy, connect and settings fields
    server.ts        its adapter, loaded with a dynamic import from the definition
    demo.ts          its part in the demo seed and the lab: id shapes, links, a sample config
    ...              wire, map, pull, webhook, fixtures, tests
```

`@hazel/customer-integrations` depends on `@hazel/domain`, `@hazel/schema` and `effect`, never on
`@hazel/db` or an app. `@hazel/db` may import it. `@hazel/domain` must not.

## The definition

A definition states facts about a tool. It holds no processing rules for fetched data.

```ts
defineIntegration({
	id,
	config: { schema, default, problem?, changeProblem? },
	ingest: { linkHosts, policy?: (config) => ({ matchByDomain, createAccounts }) },
	precedence: { name: 10, email: 20 }, // per field, lower wins
	capabilities: {
		activity?: true,
		billing?: { preference, requiresFirstImport?, invoices?, usageFromInvoices? },
		meteredLimits?: true,
		featureFlags?: true,
		impersonation?: true,
		attentionDefault?: true,
	},
	presentation, // everything the pages say and show about it
	demo?, // its role in the demo book and the lab
	server: () => import("./server"),
})
```

`presentation.settings` declares settings beyond the connect form: any number of string lists,
key-value lists and numbers, shown in declaration order and keyed by each field's config `key`.
`presentation.suggested` marks the first-run starting point
(`"start"`) and the billing source to suggest (`"billing"`), one integration each.

Capabilities are descriptive and combinable. An integration may hold any set of them, and no field
is reserved for a type of integration.

`demo` is optional and separate from capabilities: it casts the integration in one role of the demo
book (`directory`, `plans`, `invoices` or `activity`, one integration each). The seed and the lab
ask for a role with `demoSource(role)` and take the tool's id shapes, links and sample config from
what it returns.

## The guard

`boundary.test.ts` scans the core paths for each registered id and display name, whole word and
case-insensitive, camelCase and snake_case parts included, comments too. It also fails when core
imports an integration's folder rather than the package's public entries. Tests and `test-kit.ts`
are exempt: they exercise core against the real integrations. Its allowlist names each exact text
it lets through, with the reason.

## Rules

- **Provider ids are open strings.** Every RPC or route taking a provider checks it against the
  registry, since the schema cannot.
- **Config is opaque to core and decoded at the boundary.** Stored configs rely on decoding (older
  ones lack `region` and `accountId`, or carry dropped keys), and `jsonb` columns do not decode. Each
  read for an adapter or a form goes through the integration's schema. The open core schema must keep
  unknown keys.
- **Ingest policy is read at apply time.** Parked ops are replayed later, so `matchByDomain` and
  `createAccounts` must keep following the current config. They cannot move into the op.
- **`attentionDefault` sets a stored column default.** Changing who holds it changes the
  `customer_settings.attention` DDL, so it needs a migration.
- **MRR source selection** walks the billing integrations in `preference` order
  (`billingProviderOf`).
- **`FIELD_PRECEDENCE` derives from the definitions**, including which fields a manual `hazel` edit
  outranks.

## Outside this boundary

Hazel's chat integrations (`@hazel/integrations`), Hazel's own telemetry and auth, the
`@maple-dev/effect-orm` dependency, and committed migrations and snapshots.
