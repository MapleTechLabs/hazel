# Customers integrations: the boundary

Core Customers code knows no concrete tool. Everything specific to one lives in its folder in
`packages/customer-integrations/src/<id>/`, and the folder is registered in one line of
`packages/customer-integrations/src/registry.ts`.

## Benchmarks

1. No tool is named on the core side of the boundary (enforced by `boundary.test.ts`).
2. Functionality is equal: same stored data, same RPC behaviour, same UI, no migration.
3. A new integration is a new folder plus one line in `registry.ts`.

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
	server: () => import("./server"),
})
```

`presentation.settings` declares settings beyond the connect form, at most one of each kind: a
string list, a key-value list, a number. `presentation.suggested` marks the first-run starting point
(`"start"`) and the billing source to suggest (`"billing"`), one integration each.

Capabilities are descriptive and combinable. An integration may hold any set of them, and no field
is reserved for a type of integration.

## Rules that keep behaviour equal

- **Provider ids stay as stored.** `CustomerProvider` becomes an open string. Stored rows, webhook
  URLs and `_tag`s do not change. Every RPC or route taking a provider checks it against the
  registry, since the schema no longer can.
- **Config is opaque to core and decoded at the boundary.** Stored configs rely on decoding (older
  ones lack `region` and `accountId`, or carry dropped keys), and `jsonb` columns do not decode. Each
  read for an adapter or a form goes through the integration's schema. The open core schema must keep
  unknown keys.
- **Ingest policy is read at apply time.** Parked ops are replayed later, so `matchByDomain` and
  `createAccounts` must keep following the current config. They cannot move into the op.
- **The `customer_settings.attention` DDL default stays byte-identical.** It derives from
  `attentionDefault`, so no migration is generated. `schema-ddl.test.ts` must stay green.
- **MRR source selection is generalised, not changed.** `billingProviderOf` takes the billing
  integrations in `preference` order, and an exhaustive test compares it to the current two-provider
  logic.
- **`FIELD_PRECEDENCE` derives from the definitions** and must deep-equal today's table, including
  which fields a manual `hazel` edit outranks.

## Outside this boundary

Hazel's chat integrations (`@hazel/integrations`), Hazel's own telemetry and auth, the
`@maple-dev/effect-orm` dependency, and committed migrations and snapshots.
