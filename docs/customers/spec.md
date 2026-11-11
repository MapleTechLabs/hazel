# Customers v1: data model and UI surfaces

Scope: analytics, action queue and per-customer pages. No customer comms (shared channels, issues, SLAs) yet.

## Principles

- **Integrations write, the product reads.** Clerk, Stripe, Autumn and Maple each write into one neutral data model through syncs (cron) or webhooks. UI, signals and health only read that model, never a provider API.
- **Explainable over magic.** Health score and signals are rule-based and show their inputs ("No sign-ins for 18 days, was 12 weekly active users").
- **Silent accounts count.** Signals evaluate every account, including ones with no recent activity, which are often the ones about to churn.
- **A ranked queue, not a dashboard.** "Needs attention" is a worklist with assign, snooze, done and dismiss.
- **Customer = company.** An account is a B2B customer (Clerk organization). Contacts are its end users (Clerk users).

## Data model (Postgres, all tables org-scoped)

All tables: `id uuid` (branded ID), `organizationId`, `createdAt`, `updatedAt`; `deletedAt` where noted. Money in integer minor units + `currency`.

### Identity

**`customer_accounts`** (`CustomerAccountId`), soft delete

- `name`, `domain`, `logoUrl`
- `ownerUserId` → Hazel user (the CSM), nullable
- `lifecycleStage`: `lead | trialing | active | past_due | churned` (derived from subscriptions, overridable)
- `planName`, `mrrMinor`, `currency` (denormalized from active subscriptions)
- `healthScore` 0–100, `healthStatus`: `healthy | at_risk | critical | unknown`, `healthUpdatedAt`
- `seatsUsed`, `seatsLimit` (nullable)
- `firstSeenAt`, `lastActiveAt` (max contact activity), `customerSince` (first paid)
- `tags text[]`, `attributes jsonb` (free-form fields from sources)

**`customer_contacts`** (`CustomerContactId`), soft delete

- `accountId`, `email`, `name`, `avatarUrl`, `title`, `role` (e.g. Clerk org role)
- `lastSeenAt`, `lastSignInAt`, `signInCount30d`
- `attributes jsonb`

**`customer_external_refs`**: maps provider records to accounts and contacts. This is what lets four sources merge into one customer.

- `connectionId` → `integration_connections`, `provider`
- `entityType`: `account | contact`, `entityId`
- `externalId` (Clerk org/user id, Stripe customer id, Autumn customer id, Maple GroupId/UserId), `externalUrl` (deep link to the provider dashboard)
- `lastSyncedAt`
- Unique `(organizationId, provider, entityType, externalId)`
- Matching order when a source sees a new record: existing ref → shared id (e.g. Stripe `metadata.clerk_org_id`, Autumn customer id = Clerk org id, Maple GroupId = Clerk org id) → domain match → create new account. Manual "link to account" in UI for the rest.

### Billing

**`customer_subscriptions`**

- `accountId`, `provider`, `externalId`
- `planName`, `status`: `trialing | active | past_due | unpaid | paused | canceled`
- `mrrMinor`, `currency`, `interval`: `month | year | other`, `quantity`
- `startedAt`, `trialEndsAt`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `canceledAt`

**`customer_invoices`**

- `accountId`, `subscriptionId?`, `provider`, `externalId`, `number`
- `status`: `draft | open | paid | uncollectible | void`
- `amountDueMinor`, `amountPaidMinor`, `currency`
- `issuedAt`, `dueAt`, `paidAt`, `attemptCount`, `hostedUrl`

### Usage

**`customer_activity_daily`**: one row per contact per active day. Source for DAU/WAU/MAU (distinct users across days cannot be derived from per-account counts).

- PK `(contactId, day)`; `accountId`, `eventCount`, `sessionCount`, `signedIn bool`

**`customer_metric_definitions`**

- `key` (e.g. `events`, `api_requests`, `seats`, `dashboards_created`), `name`, `unit`, `aggregation`: `sum | max | last`, `provider`, `description`
- Built-in keys computed by Hazel, not sources: `active_users`, `mrr`, `health_score`

**`customer_metric_daily`**: per-account daily time series for any metric

- PK `(accountId, metricKey, day)`; `value double`
- Sources write their own metrics (Autumn feature usage, Maple event counts). The nightly rollup writes the built-ins so history exists for trends and charts.

### Timeline

**`customer_events`**

- `accountId`, `contactId?`, `provider` (`clerk | stripe | autumn | maple | hazel`)
- `type`: dotted string, e.g. `contact.joined`, `contact.removed`, `subscription.started`, `subscription.plan_changed`, `subscription.canceled`, `invoice.paid`, `invoice.payment_failed`, `usage.limit_reached`, `signal.opened`, `signal.resolved`, `note.added`
- `title`, `data jsonb`, `occurredAt`, `externalId` (dedupe, unique per provider)

### Signals and queue

**`customer_signal_rules`** (`CustomerSignalRuleId`)

- `name`, `template`, `kind`: `risk | opportunity`, `severity`: `low | medium | high`
- `config jsonb` (thresholds per template), `scope jsonb` (account filter, e.g. only paying or plan in [...])
- `enabled`, `createdBy`

Built-in templates (seeded per org, editable):

| Template                      | Default rule                                                               | Kind        |
| ----------------------------- | -------------------------------------------------------------------------- | ----------- |
| `inactive`                    | No contact activity for 14 days, after ≥1 active user in the prior 30 days | risk        |
| `usage_drop`                  | `active_users` (or any metric) 7-day avg down ≥30% vs previous 28-day avg  | risk        |
| `payment_failed`              | Subscription `past_due`/`unpaid`, or an invoice open > 7 days past due     | risk        |
| `cancel_scheduled`            | `cancelAtPeriodEnd` set, or plan downgraded                                | risk        |
| `trial_ending_low_activation` | Trial ends in ≤5 days and < 2 active users in last 7 days                  | risk        |
| `onboarding_stalled`          | Account created 7–30 days ago, < 2 contacts ever active                    | risk        |
| `health_drop`                 | Health score fell ≥20 points in 7 days, or entered `critical`              | risk        |
| `champion_inactive`           | Most active contact of last 30 days inactive 14 days                       | risk        |
| `near_limit`                  | A metered feature ≥ 90% of plan limit (Autumn)                             | opportunity |
| `seat_growth`                 | Active users up ≥50% in 30 days                                            | opportunity |

**`customer_signals`** (`CustomerSignalId`): the queue items

- `accountId`, `ruleId`, `kind`, `severity`
- `status`: `open | snoozed | done | dismissed | auto_resolved`
- `title` ("Stopped logging in"), `reason` ("No activity for 18 days; 12 weekly active users before"), `evidence jsonb` (metric values, window, invoice id…)
- `firstDetectedAt`, `lastEvaluatedAt`, `snoozedUntil`, `assigneeUserId`
- `resolvedAt`, `resolvedByUserId`, `outcome`: `contacted | fixed | not_an_issue | other`, `resolutionNote`
- Unique open signal per `(ruleId, accountId)`. If the condition clears → `auto_resolved`. A dismissed signal re-opens only if evidence worsens by a full step.
- **Priority** (queue order) = severity weight × log(MRR+1) weight × freshness. Shown as a rank, sortable by other fields.

### Health

**`customer_health_settings`**: one row per org

- `components jsonb`: weighted parts summing to 100%
    - `usage`: active users / contacts ratio and 30-day trend
    - `engagement`: days since last activity
    - `billing`: payment status, overdue invoices
    - `signals`: open risk signals by severity
- `bands`: healthy ≥ 70, at risk 40–69, critical < 40 (editable)
- A component with no data drops out and its weight is shared across the rest (Vitally pattern), so a Clerk-only org still gets a score.

### Notes

**`customer_notes`**: `accountId`, `authorUserId`, `body` (markdown), `pinned`, soft delete.

### Sync bookkeeping

- Providers `clerk | stripe | autumn | maple` are added to `integration_provider`. Stripe and Autumn need an **API-key connect flow** (new). Clerk: API key + webhook secret. Maple: API key + region (the org comes from the key).
- **`customer_sync_runs`**: `connectionId`, `trigger`: `schedule | webhook | manual | backfill`, `status`: `running | succeeded | failed`, `startedAt`, `finishedAt`, `stats jsonb` (accounts/contacts/subs/invoices/events upserted), `error`.
- Webhook URL per connection: `/webhooks/customers/{provider}/{connectionId}`, verified with that connection's secret.

### Compute pipeline (cluster)

- Webhook or cron sync → `CustomerIngest` service upserts (accounts, contacts, refs, subs, invoices, activity, metrics, events). Idempotent on `(provider, externalId)`.
- Hourly per org (`ClusterCron`): denormalize account fields (MRR, stage, lastActiveAt) → write today's built-in metrics → compute health → evaluate rules → open/update/auto-resolve signals → wake snoozed signals.
- Reads:
    - Live lists (accounts, signals, notes) via Electric + TanStack DB.
    - Aggregates and time series (overview charts, usage charts) via RPC.

### PR plan

1. **Core**: schema, domain models, RPC, ingest service, rollup/health/signal cron, all UI surfaces, data-source settings shell, dev seed script with realistic fake data. No live providers.
2. **Clerk**: orgs → accounts, users → contacts, memberships, sessions → sign-ins/activity. Webhooks + backfill.
3. **Stripe**: customers → refs, subscriptions, invoices, events. Webhooks + backfill.
4. **Autumn**: customers, products → subscriptions, feature usage + limits → metrics (`near_limit`). Webhooks + backfill.
5. **Maple**: product events (GroupId/UserId) → `customer_activity_daily` + per-event metrics. Scheduled pull. Custom first, generalized later.

## UI surfaces

New top-level **Customers** item in the icon dock (`nav-sidebar.tsx`), with its own secondary sidebar:

- Overview
- Needs attention (count badge)
- Customers, plus saved views (My customers, Paying, Trialing, At risk, Churned)
- Settings: Signals, Health score, Data sources

Routes: `/$orgSlug/customers` (overview), `/customers/attention`, `/customers/list`, `/customers/$accountId`, `/customers/settings/{signals,health,sources}`.

### 1. Overview

- Range picker (7d / 30d / 90d / 12m), compare to previous period.
- KPI row: MRR (+Δ), paying customers, active customers (≥1 active user in 30d), WAU / MAU with stickiness (WAU÷MAU), logo churn (period), at-risk MRR (sum MRR of accounts with open high-severity risk signals).
- MRR movement chart: new, expansion, contraction, churned (stacked bars) + net line.
- Active users chart: DAU / WAU / MAU lines.
- Health distribution (healthy / at risk / critical counts and MRR).
- Needs-attention preview: top 5 queue items, link to the queue.
- Top movers: biggest usage gains and drops (account, Δ%, sparkline).
- Recent churn and new customers lists.
- Empty state: no data sources connected → connect CTA cards for Clerk, Stripe, Autumn, Maple.

### 2. Needs attention (queue)

- Tabs: Open · Snoozed · Done. Filters: kind (risk / opportunity), signal type, severity, owner (default "Mine"), plan.
- Rows: rank, account (logo, name, plan, MRR), signal title + plain reason, evidence mini-viz (sparkline or invoice amount), severity, age, assignee, health badge.
- Grouping toggle: one row per signal, or one row per account with its stacked signals.
- Row actions: assign, snooze (tomorrow / 3 days / next week / date), mark done (outcome + note), dismiss (not useful), open customer.
- Keyboard: j/k, a assign, s snooze, d done, enter open.
- Side panel preview on select: account summary, signal evidence chart, other open signals, recent timeline, contacts to reach (most active / admins with emails, copy email).
- Empty state: "All clear" (+ count of snoozed).

### 3. Customers list

- Table: name + logo, owner, stage, plan, MRR, health (badge + score), active users 30d + sparkline, usage trend %, last active, open signals, customer since.
- Saved views (tabs), search, filter builder, sort, column picker, bulk assign owner / add tag.
- Health and stage colors consistent with other surfaces.

### 4. Customer page

- Header: logo, name, domain, stage, plan, MRR, health badge, owner (editable), customer since, source chips linking out to Clerk / Stripe / Autumn / Maple.
- Tabs:
    - **Overview**: KPI tiles (active users 30d, usage trend, MRR, seats used/limit, last active); usage chart with metric picker; health breakdown (each component, its score, weight, why); open signals with actions; subscription summary; pinned notes; recent activity.
    - **Users**: contacts table (name, email, role, last seen, sign-ins 30d, activity sparkline, status: active / dormant / never active).
    - **Billing**: current subscriptions, invoice table (status, amount, due, paid), payment issue banner.
    - **Activity**: timeline, filter by source and type.
    - **Notes**: composer + list, pin.
- Right sidebar: properties (owner, tags, plan, seats, attributes), linked records per source with last synced time.

### 5. Settings

- **Signals**: list of rules (enabled toggle, template, kind, severity, plain description, number of accounts matching now). Rule editor: template, thresholds, scope filter, severity, live preview of matching accounts.
- **Health score**: component weights (sliders summing to 100%), band thresholds, distribution preview.
- **Data sources**: cards for Clerk, Stripe, Autumn, Maple: status, last sync, records synced, errors, sync now, connect (API key flow), webhook URL to copy. Unmatched records count with a link to resolve.

## Additions from design pass (proposed, pending approval)

Wonder file "Maple Design System", pages `Hazel Customers · *` (Foundations, Overview, Needs Attention, List, Customer Page, Signals & Health Settings, Data Sources).

### Data model additions

- **Accounts**
    - `domains text[]` (replaces single `domain`)
    - `contactCount`, `activeUsers30d`, `activeUsersTrendPct`
    - `openRiskSignals {high,medium,low}`, `openOpportunitySignals`
    - `trialEndsAt`, `championContactId`, `championInactiveSince`, `lastActiveContactId`
    - `fieldSources jsonb` (which source set each field)
- **Contacts**: `joinedAt`, `eventCount30d`, `isBillingContact`
- **External refs**: `matchMethod` (`existing | shared_id | domain | manual | created`), `matchedByUserId`, `matchedAt`. Allow several refs per provider per account (e.g. two Stripe customers).
- **New `customer_unmatched_records`**
    - `connectionId`, `provider`, `entityType`, `externalId`, `label`, `valueMinor` / `eventCount30d`
    - `suggestedAccountId`, `confidence`, `reason`, `status` (`open | linked | ignored`)
    - Plus `customer_ignore_rules` (pattern)
- **New `customer_health_daily`**
    - `accountId`, `day`, `score`, `status`
    - `components jsonb`: per component `score`, `effectiveWeight`, `why`, `excluded`
    - Powers the breakdown, "62 → 48" changes and band-change counts.
- **New `customer_mrr_movements`**
    - `accountId`, `day`, `type` (`new | expansion | contraction | churn | reactivation`), `deltaMinor`
    - Powers the MRR movement chart, its tooltip and NRR/GRR.
- **Subscriptions and invoices**
    - `paymentMethod` (brand, last4, exp), `nextRetryAt`, `declineReason`, `cancellationReason`
    - Upcoming invoice row (`status = upcoming`)
- **Signals**
    - `severity` per signal, raised by how bad the evidence is (rule severity is the floor)
    - `priorityScore`
    - `openingEvidence` vs current `evidence`
    - `evidence.viz` type: `amount | last_active | series | limit | delta | ratio`
    - `snoozedByUserId`, `snoozedAt`, `snoozeNote`, `snoozeEvidence`
    - `reopenAfter` (cooldown), `dismissReason`
- **Signal rules**: `updatedBy`, `lastTriggeredAt`, `matchingCount`. Template metadata: required sources and friendly names.
- **Health settings**: scoring steps per input, signal deductions per severity, excluded rules (`health_drop`), `updatedBy`.
- **Notes**: `editedAt`, optional `signalId`.
- **New `customer_saved_views`**: `name`, `filters jsonb`, `sort`, `columns`, `ownerUserId` (null = shared), `position`.
- **Integration connections**
    - Status fields: `lastSuccessAt`, `lastErrorAt`, `consecutiveFailures`
    - Provider `config jsonb`: Maple activity events, metric mappings, identity keys, lookback; Stripe metadata key, domain match toggle
- **Sync runs**: `progress {step, done, total}`, structured `error {code, httpStatus}`.
- **Events**: `actorUserId`, plus types `health.status_changed`, `contact.first_active`, `signal.assigned`.

### Endpoints implied

- Dry-run a draft rule: match count, MRR, top accounts with evidence, why others don't match, queue delta.
- Dry-run health settings: distribution, how many accounts change band, sample breakdown.
