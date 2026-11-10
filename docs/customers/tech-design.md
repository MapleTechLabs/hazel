# Customers v1 (core): technical design

Product spec: `spec.md` (it predates the Durable Object rewrite; its concepts stay, its storage and
transport are replaced here). Scope of this PR: data model, ingest,
compute, RPCs, every UI surface, the lab, the dev seed, the data-sources shell. No provider
integrations (Clerk, Stripe, Autumn, Maple are stacked PRs on `CustomerIngest`).

Status: **§0–§3 contracts are implemented** (IDs, tables, migration, domain schemas, RPCs, object
kind, sync source, members projection receiver, ingest/provider interfaces, client collections).
Handlers, compute, ingest implementation, UI and lab are the work in §7.

---

## 0. Current architecture (what this builds on)

- **Objects.** One DO per org / channel / user, hosted by the api Worker; DO name = id.
    - Kinds and namespaces: `apps/backend/src/worker/objects/kinds.ts:20`.
    - Per-instance runtime (migrations, sync, outbox, in-process HazelRpc, alarm):
      `apps/backend/src/worker/objects/runtime.ts:95` (`storeOf`), `:102` (`sourceOf`), `:178`
      (`makeSyncedObject`, `deadlines` fold into one alarm), `:344` (`alarm`).
    - Alchemy class + activation: `worker/objects/org-object.ts`, `activate.ts:33`; bound in
      `apps/backend/src/worker.ts:117-121` (yielding the class binds it).
- **Stores.** effect-orm SQLite tables in `packages/db/src/tables/`, per-store lists in
  `packages/db/src/stores.ts`, append-only generated migrations (`migrations.generated.ts`,
  `snapshots/<store>.json`); objects migrate lazily on activation (`runtime.ts` → `applyMigrations`).
- **RPC.** Contracts in `packages/domain/src/rpc/*`; handlers in `apps/backend/src/rpc/handlers/*`,
  merged in `apps/backend/src/rpc/server.ts`; every object hosts every handler. The api Worker routes
  each method (`apps/backend/src/rpc/routing.ts:168`, total `RouteTable`) and forwards it.
  Mutations return `transactionId = <kind>:<id>:<seq>` (`lib/create-transactionId.ts`), awaited by
  the client.
- **Policies.** `OrgResolver` (`services/org-resolver.ts:30` `memberOf`, `:87`
  `requireAdminOrOwner`) reads `organization_members`, local only to the `OrgObject`. Channel
  objects authorize from a projection (`channel_viewers`, written by `channel.setViewers`).
- **Cross-object.** Typed outbox effects (`worker/objects/effects/registry.ts`,
  receivers per kind `effects/deliver.ts:53`, sender guards `:93`) and typed request/response calls
  from routes (`worker/objects/calls.ts`, receivers `call-receivers.ts:103`).
- **Sync.** `GET /sync/:kind/:id` and `/sync/mux` (`worker/sync-route.ts:60`); per-kind source
  with per-principal `visible` conditions (`worker/objects/sources/*`), change triggers + `_changes`
  (`packages/sync-do`). Client: `libs/effect-db-collection`, collections in
  `apps/web-foldkit/src/core/db/collections.ts`, source sets in `core/db/sync.ts`.
- **Integrations today.** `integration_connections` + encrypted `integration_tokens` live in the
  `OrgObject` (`worker/objects/org/integrations.ts:74` `ConnectIntegrationCall`); AES-GCM via
  `services/integration-encryption.ts` (`INTEGRATION_ENCRYPTION_KEY`, versioned keys); an API-key
  connect endpoint exists for Craft (`packages/domain/src/http/integrations.ts` `connectApiKey`).
  GitHub webhooks: api route → directory index → `callObject` into the `OrgObject`
  (`routes/webhooks.http.ts:57`).
- **Scheduling.** No cron/cluster: objects schedule their own work via the alarm (`rssDeadlines` in
  `worker/objects/org/rss.ts:62` is the model).
- **Frontend.** Foldkit pages (`src/page/registry.ts:49`, `src/page/contract.ts`), flat routes
  (`src/route.ts`, `orgSectionOf` `:388` defaults unknown org routes to "Chat"), shell
  (`src/shell/app-shell.ts:53` `navRail`, badge pattern `bellIcon` `:32`), sidebars
  (`src/shell/sidebars.ts`), layout dispatch (`src/app/view.ts:89` `sectionBody`, `:119`
  `secondarySidebar`). No charts and no table component exist. Gallery = vitest browser screenshots
  (`src/design.gallery.ts`). Maple's web app is also Foldkit; its lab
  (`maple/apps/web/src/lab/{define,boot,registry}.ts`) ports directly.

---

## 1. Where customer data lives — **new `CustomersObject` kind**

Decision: a fifth object kind `customers`, one per organization (DO name = organization id), with
its own store `customers`.

Why not the `OrgObject`:

- **Change-log churn.** Hourly compute rewrites health/priority fields on thousands of accounts and
  signals. In the org store every change goes through the `_changes` log every chat socket flushes
  (and the 50k/7d retention): customers compute would push chat clients into resets.
- **Snapshot weight.** Every org member's org socket would snapshot all accounts and signals on
  every reset, whether or not they ever open Customers.
- **CPU isolation.** Backfills (thousands of upserts) and compute run in the object's single thread;
  in the `OrgObject` they would delay channel/member writes and outbox receipts from chat.
- **Own schedule.** Pulls, compute, snooze wake-ups are alarms; keeping them out of the org alarm
  keeps both simple.

Real cost (all done in this PR's contracts):

- `SyncSourceKind` + write-position regex (`packages/domain/src/sync/protocol.ts:9,221`), kinds
  (`kinds.ts`), `storeOf`/`sourceOf` (`runtime.ts`), `parseEffectTarget` (`effects/registry.ts`),
  `objectReceivers` + `senderGuards` (`effects/deliver.ts`), `callReceivers`
  (`call-receivers.ts`), `SYNC_PATH` (`sync-route.ts:60`), mux `SOURCE_PATH`
  (`libs/effect-db-collection/src/mux.ts:32`), native fixture record
  (`apps/native/src/fixture/snapshot.ts`), DO class (`worker/objects/customers-object.ts`) bound in
  `worker.ts`. Alchemy derives the new SQLite class migration from the class list.
- Routing: every `customers.*` RPC → `customersTarget(payload.organizationId)`
  (`rpc/routing.ts:164`).
- Client: `customersSources` + `openCustomersSource(orgId)` (`core/db/sync.ts:35`), collections
  (`core/db/collections.ts:170+`).

Access control:

- **Members projection** `customer_members(userId, role)` written by the `OrgObject` through the
  outbox effect `customers.setMembers` (full snapshot, versioned like `channel.setViewers`;
  receiver + sender guard in `worker/objects/effects/customers-effects.ts`).
    - Sender: `OrgObject`, from `publishMembership` (`worker/objects/org/channel-access.ts:244`) and
      on role changes — only once the org has a customers object (meta flag `customersEnabled` on the
      `OrgObject`, set by the pull below).
    - Bootstrap pull: a `CustomersObject` with no members version calls the `OrgObject`
      (`org.customerMembers` call, new, returns members + roles, sets `customersEnabled`) on
      activation, then applies them with `applyMembers`.
- Read: any member (`customer_members`). Queue work (assign, snooze, done, dismiss, notes, owner,
  tags, personal views): any member. Settings, rules, shared views, built-in views, data sources,
  unmatched: `admin`/`owner` only.
- A `CustomersAccess` service in the object (`requireMember`, `requireAdmin`) replaces `OrgResolver`
  there (which reads `organization_members`, not present in this store). Scopes `customers:read` /
  `customers:write` (added to `ApiScope`, granted to every role) are declared on the RPCs.
- Sync: members only; `customer_members` is a declared dependency, so a membership change
  re-snapshots or refuses that user's sockets (`sources/customers-source.ts`).
- The sync route refuses `customers/<id>`, and RPC routing refuses every `customers.*` call, for
  users without a live `membership_index` row before waking the object (no objects for arbitrary
  ids). `org.customerMembers` answers `null` for an org with no live organization row; the object
  installs its defaults and starts computing only once it has members.
- People only: bots' machine users are not projected, and `requireMember` refuses a bot token
  whatever its scopes (V1 gives bots no Customers access).
- Org deletion: the `OrgObject` sends an empty `customers.setMembers` with `organizationDeleted`;
  the object disconnects every source (secrets dropped, running runs failed) and stops computing.
  `customers.setMembers` is an urgent outbox kind (removals land before the org answers).

## 2. Tables (`packages/db/src/tables/customers.ts`, migration `customers/0001_initial`)

Conventions: money `integer` minor units + ISO `currency`; instants are `timestamptz` (repo
convention: SQLite text, read as `Date`); a `day` is `YYYY-MM-DD` UTC text; JSON documents use
`jsonb<T>()` with ISO strings inside (`IsoTimestamp`); synced tables carry `organizationId` (client
filter), internal ones don't. Partial unique indexes in `tables/extra-indexes.ts`.

| Table                         | Purpose / key points                                                                                                                                                                                                                                                                                                                                                                                                          | Transport                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `customer_accounts`           | Customer company. `domains[]`, owner, `lifecycleStage` (+ `lifecycleStageOverride`), plan, `mrrMinor`, `trialListMrrMinor`, `trialEndsAt`, health (score/status/updatedAt), seats, `contactCount`, `activeUsers30d`, `activeUsersTrendPct`, `openRiskHigh/Medium/Low`, `openOpportunities`, champion/last-active contact, `firstSeenAt`, `lastActiveAt`, `customerSince`, `churnedAt`, `tags[]`, `attributes`, `fieldSources` | **synced**                                                                   |
| `customer_contacts`           | End users. Spec fields + `joinedAt`, `firstActiveAt`, `eventCount30d`, `isBillingContact`, `fieldSources`                                                                                                                                                                                                                                                                                                                     | RPC (per account, paged)                                                     |
| `customer_external_refs`      | Provider record ↔ account/contact. `accountId` on every ref; `matchMethod`, `matchedByUserId`, `matchedAt`, `lastSyncedAt`, `staleAt`. Unique `(provider, externalId)` for accounts, `(provider, externalId, accountId)` for contacts. Several refs per provider per account allowed                                                                                                                                          | RPC (in `account.detail`)                                                    |
| `customer_subscriptions`      | Spec + `listMrrMinor`, `cancellationReason`, `paymentMethod{brand,last4,exp}`. Unique `(provider, externalId)`                                                                                                                                                                                                                                                                                                                | RPC                                                                          |
| `customer_invoices`           | Spec + `upcoming` status (`externalId = upcoming:<sub>`), `nextRetryAt`, `declineReason`                                                                                                                                                                                                                                                                                                                                      | RPC                                                                          |
| `customer_activity_daily`     | PK `(contactId, day)`; each provider writes only its fields                                                                                                                                                                                                                                                                                                                                                                   | internal                                                                     |
| `customer_metric_definitions` | Unique `key`; built-ins `active_users`, `active_users_30d`, `mrr`, `health_score`                                                                                                                                                                                                                                                                                                                                             | **synced** (metric picker)                                                   |
| `customer_metric_daily`       | PK `(accountId, metricKey, day)`, `value`, `limitValue` (metered plan limit)                                                                                                                                                                                                                                                                                                                                                  | RPC                                                                          |
| `customer_org_daily`          | PK `day`: MRR, paying/trialing/active accounts, DAU/WAU/MAU, health counts, at-risk MRR — the overview's source                                                                                                                                                                                                                                                                                                               | RPC                                                                          |
| `customer_events`             | Timeline; unique `(provider, externalId)` when set; `actorUserId`                                                                                                                                                                                                                                                                                                                                                             | RPC (paged)                                                                  |
| `customer_mrr_movements`      | One per account per day max; `type`, `deltaMinor`, from/to                                                                                                                                                                                                                                                                                                                                                                    | RPC                                                                          |
| `customer_signal_rules`       | Spec + `updatedBy`, `lastTriggeredAt`, `matchingCount`; `config` = `RuleConfig` (tagged by template)                                                                                                                                                                                                                                                                                                                          | **synced**                                                                   |
| `customer_signals`            | Queue items. Spec + `template`, `openingEvidence`, `actionEvidence`, `priorityScore`, `openedAt`, snooze fields, `dismissReason`, `reopenAfter`, `reopenCount`, `closedAt`. One unclosed episode per `(ruleId, accountId)`                                                                                                                                                                                                    | **synced** (unclosed + closed ≤ 30 d); older via `customers.signals.history` |
| `customer_settings`           | One row: `health` (`HealthSettings`), `reportingCurrency`, `lastComputedAt`, `updatedBy` (spec's `customer_health_settings`)                                                                                                                                                                                                                                                                                                  | **synced**                                                                   |
| `customer_health_daily`       | PK `(accountId, day)`: score, status, `breakdown` (`HealthBreakdown`)                                                                                                                                                                                                                                                                                                                                                         | RPC                                                                          |
| `customer_notes`              | Spec + `editedAt`, `signalId`                                                                                                                                                                                                                                                                                                                                                                                                 | **synced**                                                                   |
| `customer_saved_views`        | `ownerUserId` null = shared, `builtInKey`, `filters`/`sort`/`columns`, `position`                                                                                                                                                                                                                                                                                                                                             | **synced** (shared + own)                                                    |
| `customer_connections`        | One per provider (reconnect reuses: stable webhook URL). Status, config, `hasWebhookSecret`, last sync/success/error, `consecutiveFailures`, `nextSyncAt`, `backfilledAt`, `stats`, `disconnectedAt`. **No secrets**                                                                                                                                                                                                          | **synced**                                                                   |
| `customer_connection_secrets` | Encrypted API key + webhook secret (`IntegrationEncryption`)                                                                                                                                                                                                                                                                                                                                                                  | internal, never synced                                                       |
| `customer_sync_runs`          | Spec + `progress`, structured `error`, `cursor`                                                                                                                                                                                                                                                                                                                                                                               | **synced** (last 7 d)                                                        |
| `customer_unmatched_records`  | Spec + `email`, `domain`, `payload` (the op, replayed on link). Unique `(provider, entityType, externalId)`                                                                                                                                                                                                                                                                                                                   | RPC                                                                          |
| `customer_ignore_rules`       | `provider?`, `entityType`, `field`, glob `pattern`                                                                                                                                                                                                                                                                                                                                                                            | RPC                                                                          |
| `customer_members`            | Projection `(userId, role)`                                                                                                                                                                                                                                                                                                                                                                                                   | internal                                                                     |

Domain shapes: `packages/domain/src/customers/` (`enums`, `models` — row models for synced and RPC
rows, `evidence`, `rules`, `health`, `views`, `connections`, `ingest`, `analytics`), exported as
`@hazel/domain/customers`.

## 3. Ingest API (`apps/backend/src/worker/objects/customers/ingest.ts`)

Integrations never write tables. An adapter (`customers/providers.ts`) turns a webhook or a pull
page into `IngestOp`s (`packages/domain/src/customers/ingest.ts`); `CustomerIngest` applies them
inside the `CustomersObject`.

```ts
// Ops (Schema, tagged): account | contact | subscription | invoice | activity | metric
//                      | metric_definition | event. Records name others by ProviderRef.
type ProviderRef = { provider: CustomerProvider; externalId: string }

interface CustomerIngestShape {
  apply(ctx: IngestContext, ops: ReadonlyArray<IngestOp>):
    Effect<IngestReport, CustomerIngestRejectedError | DatabaseError, Database | SqlClient>
  startRun(connectionId, trigger): Effect<CustomerSyncRunId, DatabaseError, …>
  progress(runId, progress: SyncProgress): Effect<void, DatabaseError, …>
  finishRun(runId, { _tag: "Succeeded"; cursor } | { _tag: "Failed"; error: SyncError }): Effect<void, …>
  link(recordId, accountId, by: UserId): Effect<IngestOutcome, …>   // manual match + replay
  setStale(connectionId, stale: boolean): Effect<void, …>            // disconnect / reconnect
}
interface IngestContext { connectionId; provider; runId: CustomerSyncRunId | null; trigger: SyncTrigger }
// IngestReport = { stats: SyncStats; outcomes: (Created|Updated|Unchanged|Unmatched|Ignored)[] }
```

Rules:

- **Idempotent** on `(provider, externalId)`; unchanged rows are not written (no `_changes` churn).
  Ops apply in order, ≤ 500 per transaction (`INGEST_CHUNK`).
- **Account matching**, first hit wins: (1) existing ref → (2) `sameAs` shared ids (Stripe
  `metadata.clerk_org_id`, Autumn id = Clerk org id, Maple GroupId = Clerk org id) resolved through
  refs → (3) domain (any of the record's domains, free-mail domains excluded) → (4)
  `onNoMatch: "create"` creates (`matchMethod: created`) or parks an **unmatched record**. More than
  one candidate at a step = ambiguous → unmatched with `suggestedAccountId` + `confidence`. Ignore
  rules run before (4).
- **Contacts:** ref `(provider, externalId, accountId)` → same email (case-insensitive) in the
  account → create. Unknown account → unmatched (entityType `contact`).
- **Billing/metrics/events/activity** resolve the account (and contact) through refs; unresolved →
  unmatched record holding the op, replayed by `link`.
- **Field precedence:** `FIELD_PRECEDENCE` (`hazel` manual edit > clerk > stripe > autumn > maple for
  name; per field), recorded in `fieldSources`; domains merge (never removed); fixed in v1.
- **Deletes:** `account.deleted` → ref `staleAt`; account soft-deleted when it has no live ref.
  `contact.removed` → soft delete + `contact.removed` event.
- **Events** are emitted by ingest for state changes it observes (subscription started / plan
  changed / canceled, invoice paid / payment_failed, contact joined / removed), deduped by
  `externalId`.
- Ingest never computes; it marks compute due (`requestCompute`, ≤ 2 min debounce).
- **Disconnect** keeps all data: refs of the connection get `staleAt`, connection `disconnected`,
  secrets deleted; UI shows stale source chips.

## 4. Compute pipeline (in the `CustomersObject`)

### 4.1 Schedule

- Alarm deadlines (folded into the object's one alarm, like `rssDeadlines`): `computeDueAt`
  (hourly, and ≤ 2 min after ingest / rule / settings changes), each connection's `nextSyncAt`,
  the earliest `snoozedUntil`, the earliest `reopenAfter`.
- Compute is one function `runCompute(now)`, steps below; each step its own transaction(s), chunked
  by 500 accounts. `customer_settings.lastComputedAt` records it.

### 4.2 Rollups (per account, then org)

- Active contact on day d: activity row with `eventCount > 0 || sessionCount > 0 || signedIn`.
- `activeUsers30d` = distinct active contacts in `[d-29, d]`. DAU/WAU/MAU = distinct over 1/7/30 days.
- `activeUsersTrendPct` = (avg DAU over last 7 d) vs (avg DAU over the 28 d before) → % change;
  null when the baseline avg is 0.
- `lastActiveAt` / `lastActiveContactId` = max over contacts; champion = most active contact by
  active days (tie: events) in 30 d; `championInactiveSince` = their last active day if ≥ 1 d ago.
- Billing source: **Autumn when an active Autumn connection exists, else Stripe** (subscriptions of
  the other provider are ignored for MRR). Invoices always from Stripe.
- `mrrMinor` = Σ non-canceled subscription MRR (reporting currency only; other currencies counted
  in `attributes.foreignMrr`); `planName` = highest-MRR subscription's; `trialEndsAt`;
  `trialListMrrMinor` = Σ `listMrrMinor` of trialing subs.
- Stage (unless overridden): any `past_due|unpaid` → `past_due`; any `active` with MRR > 0 →
  `active`; any `trialing` → `trialing`; had MRR before and none now → `churned` (`churnedAt` set);
  else `lead`. `customerSince` = first day MRR > 0.
- Built-in metrics for today: `active_users` (DAU), `active_users_30d`, `mrr`, later `health_score`.
- MRR movements (yesterday's `mrr` vs today's): 0→>0 `new` (or `reactivation` if `churnedAt` set
  before), >0→0 `churn`, up `expansion`, down `contraction`.
- `customer_org_daily[today]` from the above (+ at-risk MRR = Σ MRR of accounts with an open high
  risk signal).
- After a backfill: rebuild `active_users*`, `mrr` (from subscription start/cancel dates),
  movements and `customer_org_daily` for the last 365 days, so charts have history on day one.

### 4.3 Health (`packages/domain/src/customers/health.ts`)

- Components, each 0–100 or excluded (no data):
    - `usage` = 60% ratio step(activeUsers30d ÷ max(contactCount, 1)) + 40% trend step
      (`activeUsersTrendPct`). Excluded without any activity source data for the org.
    - `engagement` = step(days since `lastActiveAt`). Excluded like usage.
    - `billing` = min of applicable: past_due/unpaid 20, invoice > 7 d overdue 30, overdue 60,
      cancel scheduled 40, else 100. Excluded without a billing source or with no subscription.
    - `signals` = 100 − Σ deduction per open risk signal (high 30 / medium 15 / low 5), floor 0;
      templates in `excludedTemplates` ignored (default `health_drop`, `near_limit`, `seat_growth`).
- Redistribution: `effectiveWeight_i = w_i / Σ w_available × 100`. Score = round(Σ eff × score).
  No score (status `unknown`) when only `signals` is available, or the account is **churned**.
- Bands: `healthy ≥ healthyMin (70)`, `at_risk ≥ atRiskMin (40)`, else `critical`.
- Writes `customer_health_daily[today]` (breakdown with `why`), account health fields, and a
  `health.status_changed` event on band change.

### 4.4 Signal evaluation (`packages/domain/src/customers/rules.ts`, `evidence.ts`)

Every enabled rule × every in-scope, non-churned account (silent accounts included). A template
needs ≥ 1 of its `requiredSources` connected, else it matches nothing (dry-run reports it).

| Template                      | Match (defaults)                                        | Evidence (`_tag` = viz) | Escalation `step` +1 / +2           |
| ----------------------------- | ------------------------------------------------------- | ----------------------- | ----------------------------------- |
| `inactive`                    | no activity 14 d, ≥ 1 active user in the 30 d before    | `last_active`           | ≥ 2× / ≥ 4× threshold days          |
| `usage_drop`                  | metric 7-d avg ≤ −30% vs prior 28-d avg                 | `series` (35 d)         | ≤ −50% / ≤ −75%                     |
| `payment_failed`              | sub `past_due`/`unpaid`, or invoice open > 7 d past due | `amount`                | ≥ 14 d / ≥ 30 d overdue or `unpaid` |
| `cancel_scheduled`            | `cancelAtPeriodEnd`, or contraction in 14 d             | `delta` (minor)         | takes effect ≤ 7 d / —              |
| `trial_ending_low_activation` | trial ends ≤ 5 d, < 2 active in 7 d                     | `ratio`                 | ≤ 2 d left / 0 active               |
| `onboarding_stalled`          | first seen 7–30 d ago, < 2 contacts ever active         | `ratio`                 | age ≥ 21 d / 0 active               |
| `health_drop`                 | −20 pts in 7 d, or entered critical                     | `delta` (points)        | −35 pts / −50 pts                   |
| `champion_inactive`           | champion (30 d) inactive 14 d                           | `last_active`           | as `inactive`                       |
| `near_limit`                  | metered metric ≥ 90% of limit                           | `limit`                 | ≥ 100% / ≥ 120%                     |
| `seat_growth`                 | activeUsers30d +50% vs 30 d ago, from ≥ 3               | `delta` (users)         | +100% / +200%                       |

- Severity = `escalate(rule.severity, step)` (rule severity is the floor).
- Title = template name (or the rule's name if renamed); reason = one plain sentence from evidence
  ("No activity for 18 days; 12 weekly active users before").

### 4.5 Signal lifecycle (per `(rule, account)`, one unclosed row)

- Condition true, no unclosed row → **open** (new row, `signal.opened` event), unless the rule is
  in baseline mode (§4.7).
- **open**: update evidence/severity/priority each run. Condition false → `auto_resolved`, `closedAt`.
- **snoozed**: wakes to open at `snoozedUntil`; wakes **early** when `evidence.step >
  actionEvidence.step` or severity rose ("got worse", event `signal.woke`). Condition false →
  `auto_resolved` + closed.
- **done**: `reopenAfter = resolvedAt + 7 d`. Condition false → closed (status stays done). Still
  true at `reopenAfter` → reopen (`reopenCount++`, `openedAt = now`).
- **dismissed**: stays while true; reopens only when `evidence.step > actionEvidence.step` (worse by a
  full step). Condition false → closed.
- Every human action stores `actionEvidence` = current evidence. Assign/snooze/done/dismiss/note
  write `hazel` events (`signal.assigned`, …).
- Account counters (`openRisk*`, `openOpportunities`) and rule `matchingCount`/`lastTriggeredAt`
  updated at the end of evaluation.

### 4.6 Priority

`priorityScore = severityWeight × valueWeight × freshness`

- `severityWeight`: low 1, medium 2, high 4.
- `valueWeight = 1 + log10(1 + value/100)` with `value` = `mrrMinor`, else `trialListMrrMinor`
  (trials rank by plan list price), else 0 → weight 1 (no-MRR fallback: severity and freshness
  decide).
- `freshness = max(0.5, 1 − ageDays/28)`, age from `openedAt`.
- Queue order = `priorityScore desc`, rank shown 1..n.

### 4.7 Backfill must not flood

- `finishRun` of a successful `backfill` sets meta `baselineFor = <connectionId>`; the next compute
  runs rules whose template has `baselineOnBackfill` in **baseline mode**: a new match is written as
  `dismissed` with `dismissReason = "baseline"` (no event, no queue entry). It surfaces only if it
  gets worse by a full step (dismissed reopen rule) or after it clears and recurs.
- Time-bounded templates (`payment_failed`, `cancel_scheduled`, `trial_ending_low_activation`) open
  normally: they are actionable now.

### 4.8 Dry runs (read RPCs; pure functions shared with compute)

- `customers.rule.dryRun`: match count, MRR, top 10 matches with evidence, non-match reasons
  histogram (out of scope / below threshold / no data / missing source), queue delta vs the rule's
  current signals.
- `customers.health.dryRun`: current vs proposed distribution, transitions, sample breakdowns.
- Evaluation and scoring are pure (`(snapshot, config) → result`) so compute, dry runs and unit
  tests share them.

## 5. Webhooks, secrets and pulls (framework only)

- **Connect** (`customers.connection.connect`, admin): adapter `validate` → encrypt API key and
  webhook secret with `IntegrationEncryption` into `customer_connection_secrets` → upsert
  `customer_connections` (one per provider) → schedule a `backfill` run. No adapter registered →
  `CustomerProviderUnavailableError` (core state; the UI shows "coming soon" / seeded demo data).
- **Webhook route** on the api Worker: `POST /webhooks/customers/:provider/:organizationId/:connectionId`
  (org id in the path; the signature is the auth). The route reads the
  raw body and forwards it with a typed call `customers.webhook` (`defineCall(..., "customers", …)`)
  to `customersTarget(organizationId)` once `org_index` knows the org (else 404, nothing woken),
  reading at most 1 MB (413 past it, counted while streaming); the object loads the secret (none →
  400, the adapter is never called), `adapter.webhook` verifies (signature and timestamp tolerance)
  and parses, `CustomerIngest.apply` (trigger `webhook`; ops are checked against the contract).
  Bad signature → 400, unknown connection → 404, ingest failure → 500 (provider retries; ingest is
  idempotent).
  The webhook URL shown in the UI is built client-side from these ids.
- **Scheduled pulls:** per connection `nextSyncAt = lastSyncAt + adapter.pullIntervalMs`; the alarm
  runs due pulls page by page (`adapter.pull(cursor, since)` → `apply` → `progress`), persisting the
  cursor on the run so an evicted object resumes. Backfill = `since: null`. `auth` errors →
  connection `error`, pulls stop until credentials change; other errors back off
  (`consecutiveFailures`, exponential, cap 6 h).
- **Sync now** = a `manual` run scheduled immediately.
- Adapter contract: `apps/backend/src/worker/objects/customers/providers.ts`
  (`validate`, `webhook`, `pull`, `pullIntervalMs`); provider PRs register theirs in
  `CustomerProviders.layer`.

## 6. Frontend (`apps/web-foldkit`)

### 6.1 Structure

- **Routes** (`src/route.ts`): `CustomersOverview` `/$org/customers`, `CustomersAttention`
  `/$org/customers/attention`, `CustomersList` `/$org/customers/list?view=`, `CustomerDetail`
  `/$org/customers/$accountId?tab=` (`overview|users|billing|activity|notes`),
  `CustomersSettingsSignals` `/$org/customers/settings/signals` (+ `/new`, `/$ruleId`),
  `CustomersSettingsHealth` `/$org/customers/settings/health`, `CustomersSettingsSources`
  `/$org/customers/settings/sources`, `CustomersSourceDetail` `…/sources/$provider`,
  `CustomersUnmatched` `…/sources/unmatched`. Literal segments before `$accountId` in `oneOf`.
  `OrgSection` gains `"Customers"`; `isCustomersRoute`; `titleOf`; `route.test.ts` examples.
- **Shell:** "Customers" item in `navRail` (`src/shell/app-shell.ts:53`) and mobile nav; secondary
  sidebar `src/shell/customers-sidebar.ts` (Overview, Needs attention + count badge, Customers +
  saved views, Settings: Signals, Health score, Data sources); `app/view.ts` `sectionBody` /
  `secondarySidebar` branches.
- **Data:** entering any customers route calls `openCustomersSource(orgId)` (shell subscription);
  live lists via `liveQueryStream` over the customer collections filtered by `organizationId`;
  aggregates/series via `HazelRpc` stored as `AsyncData` in page models; mutations via
  `optimisticAction` awaiting the `customers:<org>` transactionId (`src/core/db/actions.ts`).
- **Needs-attention badge** = count of `customer_signals` with status `open` whose account's
  `ownerUserId` is me (client-side join), shown on the sidebar item (spec: badge lives in the
  secondary sidebar; the dock item gets none in v1, so the source opens only when the area is used).
- "Mine" (queue default) = signals on accounts I own.

### 6.2 Charts — hand-rolled SVG

Nothing chart-like exists; Maple's production charts use `@tanstack/charts` on canvas with a Mount
bridge (`maple/packages/views/src/charts/chart-mounts.ts`). For our shapes (sparklines, 2–4 series
lines, stacked bars + net line, meters) **hand-rolled SVG views** are smaller, theme with CSS
variables directly (no canvas color resolution), and render in the gallery and scene tests.

- `src/customers/charts/scale.ts`: linear scale, nice ticks, day/week/month bucketing, formatters.
- Pure views `(h, data, options) → Html`: `sparkline`, `barSparkline`, `lineChart` (multi-series,
  axis, grid), `stackedBarChart` (+ net line overlay), `distributionBar` (HTML/CSS, like Maple's
  `hbar-chart.ts`), `meter` (limit), `deltaPill`.
- Hover: charts emit `HoveredIndex(index | null)` through a caller-supplied message; the page keeps
  the index and renders the tooltip (`chartTooltip`). No chart owns state.
- Colors: Wonder tokens `hazel/chart-new|expansion|contraction|churn|healthy|at-risk|critical|
  series-1..3|grid` → CSS variables in `src/core/styles/theme.css`.

### 6.3 Components (Wonder "Maple Design System", pages `Hazel Customers · *`)

From _Foundations_ (artboards in parentheses) → `src/customers/ui/`:

- `healthBadge` (Health Badge States: label, score, compact dot), `severityChip` / `kindChip`
  (Severity And Kind Chips), `stageBadge` (Lifecycle Stage Badges, trial detail), `sourceChip` /
  `sourceMark` (Source Chips: chip, link chip, mark tiles; Brandfetch-free brand marks per
  `hazel/logo-*` tokens), `companyLogo` (Avatars And Company Logos: sizes, tint fallback),
  `kpiTile` (KPI Tile Variants), sparklines (Sparkline Variants, Evidence Row), `lineChart` (Line
  Chart Active Users), `stackedBarChart` (Stacked Bar Chart MRR Movement), `distributionBar`
  (Distribution Bar Health), `dataTable` (Table Customers States: sortable header, selection,
  skeleton), `queueRow` (Queue Row Signal States), `filterBar` / `rangePicker` / `viewTabs`
  (Filter Bar And Tabs), `snoozeMenu` / `rowActionsMenu` (Menus Snooze And Row Actions),
  `emptyState` variants (Empty State Variants), `connectCard` (Integration Connect Cards),
  `evidenceViz` (one view per evidence `_tag`).

Pages (artboards):

- _Overview_: default 30d, hover tooltips, empty (no sources → connect cards), partial (no billing),
  12-month range.
- _Needs Attention_: open/mine, grouped by account, selected + side panel preview, snooze menu, mark
  done dialog (outcome + note), snoozed tab, done tab, all clear. Keys j/k/a/s/d/enter.
- _List_: all, at-risk view, filter builder popover, column picker, bulk selection bar + assign
  owner menu, row hover card, no results, first run.
- _Customer Page_: overview/users/billing/activity/notes tabs, billing payment failed banner, header
  actions menu, health breakdown with excluded component.
- _Signals & Health Settings_: rules list, template picker modal, rule editor (inactive, usage
  drop) with live preview, health settings with unsaved-changes bar, weights validation error.
- _Data Sources_: overview cards, connect (API key) modal, source detail (Clerk), unmatched records
  resolver, Maple source settings, test-connection failure.

### 6.4 Lab

Port Maple's lab: interactive, fixture-driven Foldkit programs at `/lab/<path>` (dev, or
`VITE_HAZEL_LAB=on`), complementing the screenshot gallery.

- `src/lab/define.ts` (`defineLab(title, program)` → `Runtime.makeElement` into a container),
  `src/lab/boot.ts` (`import.meta.glob("./entries/**/*.ts")`, `/lab/*` switch in `src/entry.ts`
  before `startApplication`), `src/lab/registry.ts` + `registry.test.ts` (list = entry files).
- Entries `src/lab/entries/customers/*`: one per Foundations artboard (kit), one per page with a
  state toolbar (`?state=empty|partial|…`), mounting the real page `update`/`view` with fixture
  models (Maple's `shell-lab.ts` pattern), commands stubbed.
- Fixtures `src/lab/fixtures/customers.ts`: fixed `NOW`, ~40 named accounts covering edge cases
  (no MRR trial, churned, past due, huge MRR, long names, no logo, every evidence viz, every signal
  status), overview/detail RPC results, built typed against `@hazel/domain/customers`.

### 6.5 Dev seed

`customers.demo.seed` (admin; enabled where `CUSTOMERS_DEMO_SEED=1`, i.e. local and preview): a
deterministic generator (seeded PRNG) produces ~120 accounts, ~1.5k contacts, 12 months of activity,
subscriptions with upgrades/downgrades/churn, invoices incl. failures, Autumn-like metered metrics,
events — as `IngestOp`s with fake `clerk`/`stripe`/`autumn`/`maple` connections (status `active`,
no secrets) — applied through `CustomerIngest.apply`, then a history rebuild and compute (baseline
off, so the queue is populated). A "Load demo data" button on the Data Sources page in dev.

## 7. Work breakdown (4 agents, disjoint files)

Contracts landed (§0–§3, this PR). Shared files below are edited **only** by the named owner; others
request changes.

### (a) Backend — `apps/backend/**`, `packages/domain/src/customers/**` (fixes only)

- Owns: `apps/backend/src/worker/objects/customers/**` (ingest impl, compute, evaluation, health,
  priority, lifecycle, pulls/alarm deadlines, access, seed generator), `rpc/handlers/customers.ts`
  (replace the stubs), `worker/objects/effects/customers-effects.ts`,
  `worker/objects/sources/customers-source.ts`, `routes/customers-webhooks.http.ts` (new) + its
  registration in the api's route list, `worker/objects/org/*` changes for `setMembers` sending and
  the `org.customerMembers` call, `runtime.ts` (alarm/deadline hooks for `customers`),
  `sync-route.ts` (membership check for `customers`), tests under
  `apps/backend/src/worker/objects/customers/*.test.ts`.
- Also owns `packages/db/src/tables/customers.ts` + migrations for any schema change (generate a new
  migration; do not edit `0001_initial` once committed — before the first commit, regenerating is
  fine), and `packages/domain/src/customers/**` + `rpc/customers.ts` contract changes (announce
  them to b/c/d).
- Order: access + members → ingest → rollups → health → evaluation/lifecycle/priority → read RPCs →
  mutations → dry runs → seed → webhook/pull framework.

### (b) Design system, charts, lab — frontend kit

- Owns: `src/customers/ui/**`, `src/customers/charts/**`, `src/customers/format.ts` (money, %,
  relative days), `src/lab/**`, the `/lab` switch in `src/entry.ts`, chart/health color tokens in
  `src/core/styles/theme.css`, `src/customers/customers.gallery.ts`.
- Delivers first (others consume): badges/chips, kpiTile, sparklines, charts, dataTable, queueRow,
  evidenceViz, menus, empty states, connectCard; then lab fixtures (`src/lab/fixtures/customers.ts`)
  and kit entries. Page lab entries are added by c/d in `src/lab/entries/customers/pages/*` (their
  files), registered in `src/lab/registry.ts` by b on request.

### (c) Pages A — shell, overview, needs attention

- Owns: `src/route.ts` + `src/route.test.ts` (**all** customers routes, incl. d's), `src/page/registry.ts`
  (registers every customers page, incl. d's), `src/app/view.ts`, `src/shell/app-shell.ts`,
  `src/shell/mobile.ts`, `src/shell/customers-sidebar.ts`, the shell subscription that calls
  `openCustomersSource`, `src/page/customers/overview/**`, `src/page/customers/attention/**`,
  `src/customers/queries.ts` (shared live queries: accounts by org, open signals, mine, badge
  count), `src/customers/actions.ts` (optimistic actions for signals/notes/accounts — used by d too).
- Lands routes + registry + sidebar with placeholder pages for d's tabs first (day 1), so d plugs in.

### (d) Pages B — list, customer page, settings

- Owns: `src/page/customers/list/**`, `src/page/customers/detail/**`,
  `src/page/customers/settings/{signals,health,sources,unmatched}/**`, and their lab entries.
- Uses c's routes/queries/actions and b's kit; asks c for route/registry changes.

**Integration order:** contracts (done) → b kit primitives + c routes/shell skeleton (parallel) →
a read RPCs with seed (unblocks real data) → c/d pages against lab fixtures, then real RPCs → a
mutations/compute → end-to-end pass on `alchemy:dev` with the demo seed.

## 8. Testing

- **Backend objects** (vitest, in-memory node SQLite via `worker/objects/testing.ts`; see
  `customers-object.test.ts`): members projection + access, sync visibility, each RPC's
  authorization (member vs admin), transactionId confirmation.
- **Ingest:** matching order table-driven (ref, shared id, domain, ambiguous, ignore rule, create),
  idempotent replays (apply twice → `Unchanged`, no `_changes` rows), precedence, unmatched → link
  replay, stale on disconnect.
- **Compute (pure, fixtures):** rollup formulas, MRR movements, health components +
  redistribution + bands + churned → unknown, each template's match/evidence/step, lifecycle state
  machine (open → snooze → wake worse, done → reopen after 7 d, dismissed reopen on step, auto
  resolve, baseline after backfill), priority ordering incl. no-MRR and trials.
- **Frontend:** story tests for page updates, scene tests for key flows (snooze from queue, mark done
  dialog, rule editor dry-run, health weights validation, connect modal errors), route examples,
  lab registry test, gallery screenshots of the kit.
- **DB:** `schema-ddl.test.ts` (store in sync with its snapshot).

## 9. Open risks

- **Compute cost at scale** (10k accounts × 30-day windows each hour): keep rollups incremental
  (only accounts with activity/billing changes since the last run + time-based templates), measure
  in the seed; split into resumable chunks across alarm invocations if a run exceeds ~10 s.
- **Members bootstrap race:** the first socket to a fresh customers object is refused (`not_found`)
  until the pull lands; the client retries. Acceptable; the pull runs on activation.
- **Currency:** single reporting currency; mixed-currency orgs undercount MRR (flagged, no FX).
- **Local cache:** customer rows persist in the browser's local cache like org rows.
- **Retention of signals stream:** closed signals age out of visibility only on the next reset (no
  delete is sent when a row passes 30 days); harmless, the Done tab filters by date.
