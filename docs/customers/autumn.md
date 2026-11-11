# Autumn data source

Hazel's **MRR source once it is connected**: an Autumn customer lands on the account an identity
source already created, the **plans** it holds become the MRR, the plan name, the trial and the
payment state, and its **feature balances** become the daily usage metrics and plan limits the
`near_limit` signal reads. Stripe keeps the invoices either way, and its subscriptions step aside
while Autumn is connected — Autumn is what the app actually bills through (`tech-design.md` §4.2).
Adapter: `apps/backend/src/worker/objects/customers/autumn/`, registered in `customers/providers.ts`.
It produces `IngestOp`s only — `CustomerIngest` does every write (`tech-design.md` §3).

Autumn never creates a customer record on its own (`onNoMatch: "unmatched"`). It lands on one of
three ways, first hit wins (`tech-design.md` §3):

1. its own external ref, from a previous sync;
2. a **shared id** — the Autumn customer id *is* the Clerk organization id. This is the whole
   identity rule, and it is a toggle (`AutumnConnectionConfig.customerIdIsClerkOrgId`, **on** by
   default) because it is only true of an app that creates one Autumn customer per Clerk
   organization and passes the organization id as `customer_id` (Maple does; so does Hazel). An app
   that keys Autumn by its own user or workspace id must turn it off;
3. the **domain** of the customer's email, used **only while the toggle is off**. With the shared id
   on, a billing email is never read as a domain: it is often an accountant's or a founder's own.

Anything else waits in the unmatched list, holding its op, and ingest replays it the moment someone
links it.

## Setting it up

1. **Secret key** — Autumn → **Developer → Keys**. Copy the key of the environment whose customers
   you track: `am_sk_test_…` reads your **sandbox**, `am_sk_live_…` your **live** data. Autumn's
   secret keys are not scoped per resource, so there is nothing to tick; connecting reads one record
   of each resource Hazel needs, so a key that cannot reach one says so at connect time instead of
   failing the first backfill.

   The connection's `externalAccountId` is `<organization id>:<env>` — the pair, never just the
   organization. `GET /v1/organization/me` answers both, and the key's own prefix is checked against
   Autumn's answer: a `am_sk_test_…` key that opens the live environment (or the other way round)
   **fails to connect** rather than being guessed at, because that pairing is exactly how sandbox
   data ends up in a production connection. Moving a connection from sandbox to live is therefore a
   change of provider account: core drops the old environment's data and imports from scratch.

2. **Webhook** — Autumn → **Developer → Webhooks** → add an endpoint:

    ```
    POST https://<api host>/webhooks/customers/autumn/<organizationId>/<connectionId>
    ```

    The data-sources page shows the exact URL once the connection exists (the ids are in the path,
    the signature is the auth). Subscribe:

    `billing.updated`, `balances.limit_reached`, `balances.usage_alert_triggered`

    The webhook is optional: without one every change still arrives through the scheduled walk, up
    to 6 hours late.

3. Paste the endpoint's **signing secret** (`whsec_…`) into the connect form. Autumn delivers through
   **Svix**, so the same verification Clerk uses applies (`customers/svix.ts`): the signature over
   the raw body, and a ±5 minute replay window. Both secrets are stored encrypted in
   `customer_connection_secrets` and decrypted only to call Autumn or verify a delivery.

Every request pins `x-api-version: 2.5.0`. **This is not optional**: with no such header Autumn
picks the version from the *organization's creation date* (`apiVersionMiddleware`), so the same
request would answer in different shapes for different Hazel customers.

## Mapping

| Autumn                                                      | Hazel                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| customer `id`                                               | account external ref `(autumn, <id>)`                   |
| customer `id`, with the toggle on                            | `sameAs` → the Clerk account (`matchMethod: shared_id`) |
| customer `email` domain, with the toggle off                 | a domain match                                          |
| customer `name`                                             | `account.name` (Clerk's wins, `FIELD_PRECEDENCE`)       |
| customer `created_at`                                       | `account.firstSeenAt` if earlier                        |
| customer `licenses[].granted` / `.usage` (summed)           | `account.seatsLimit` / `seatsUsed` (outranks Clerk's)   |
| customer gone from a full walk                              | ref goes stale; account soft-deleted with no live ref   |
| plan `price.amount × quantity`, per interval                | `subscription.mrrMinor` (see below)                     |
| plan `name` (else the `plan_id`)                            | `subscription.planName`                                 |
| `past_due`, `trial_ends_at`, `expired`                      | `subscription.status` (see below)                       |
| subscription `started_at`                                   | `subscription.startedAt`                                |
| subscription `trial_ends_at`                                | `subscription.trialEndsAt`                              |
| `current_period_end`, else `expires_at`                     | `subscription.currentPeriodEnd`                         |
| `canceled_at` on a plan still running                       | `cancelAtPeriodEnd`, `canceledAt`                       |
| balance `usage`                                             | `metric_daily.value` for `autumn.<feature_id>`          |
| balance `granted` (not unlimited, > 0)                      | `metric_daily.limitValue` — what `near_limit` measures  |
| feature `name`                                              | the metric definition's name (`aggregation: max`)       |
| `balances.limit_reached`                                    | timeline `usage.limit_reached`                          |
| `balances.usage_alert_triggered`                            | timeline `usage.limit_approaching`                      |

Ingest raises the subscription timeline entries itself — `subscription.started`,
`subscription.plan_changed`, `subscription.cancel_scheduled`, `subscription.canceled` — from the
state changes these ops describe, so the adapter emits only the two usage entries, which ingest
cannot see.

**Metric keys are namespaced** `autumn.<feature_id>`. Ingest refuses a metric key another provider
already owns (`otherOwner`), so the prefix is what keeps an Autumn feature called `events` from
colliding with a Maple event metric of the same name. The built-in keys (`active_users`, `mrr`,
`health_score`) are Hazel's and are refused outright.

**Statuses.** Autumn reports a plan as `active` (with `past_due` beside it), `scheduled`, or
`expired`, and clears `trial_ends_at` when a trial converts. So:

| Autumn                                | Hazel       |
| ------------------------------------- | ----------- |
| `past_due: true`                      | `past_due`  |
| `trial_ends_at` set                   | `trialing`  |
| otherwise active                      | `active`    |
| `status: "expired"`                   | `canceled`  |
| `status: "scheduled"`                 | **skipped** |

A `scheduled` plan is skipped: it bills nothing yet, Hazel's model has no scheduled status, and
recording it as active would count a future plan's amount as MRR today. The downgrade it usually
belongs to is already visible as `cancelAtPeriodEnd` on the plan it replaces. Hazel's `unpaid` and
`paused` have no Autumn equivalent and are never written by this source.

**Ordering.** Every op carries `observedAt`, the time taken before its read (Autumn's records carry
no `updated_at`). Ingest keeps the newest one applied per subscription and drops an older read, so a
slow delivery or pull page cannot overwrite what a newer one wrote, and a late delivery cannot revive
a customer deleted since.

**No contacts.** Autumn holds no users of its own — a customer is the company — so this source
writes no contacts and its walk never sweeps them, only accounts.

### MRR

`mrrMinor` is a **monthly** amount in the currency's **minor units**. Autumn quotes plan amounts in
**major** units ("in major currency units (e.g. dollars)") of the organization's
`default_currency`, so the amount is scaled by that currency's minor-unit factor — 100 normally, 1
for a zero-decimal currency (JPY, KRW …), 1000 for a three-decimal one — taken from the same Stripe
currency table Autumn bills through.

- Per subscription: the plan's **base price** `amount × quantity`, normalized to a month —
  `/month` as it is, `/year ÷ 12`, `/quarter ÷ 3`, `/semi_annual ÷ 6`, `/week × 52/12`, each divided
  by the price's `interval_count`. A missing quantity counts as one.
- A `one_off` base price, or a plan with **no base price** (Autumn's free tier, a usage-only plan),
  is **MRR 0** — which is what it bills every month.
- A plan's **per-feature item prices count as nothing.** A `usage_based` one bills after the
  included units and its amount is not knowable in advance (Stripe's metered prices are left out the
  same way); a `prepaid` one bills for units Autumn reports on the customer's *balances*, not on the
  subscription. Those features are read as **metrics** instead, which is what `near_limit` and the
  usage charts are for. See Known gaps.
- `listMrrMinor` equals `mrrMinor`: Autumn exposes no per-customer discount on a subscription, so
  there is no list price to keep apart.
- The amount is rounded once, at the end, and never goes below zero.
- `mrrMinor` is what the plan bills **or would bill**, whatever its status: compute decides which
  statuses count towards an account's MRR (`tech-design.md` §4.2).
- Prices come from `POST /v1/plans.list` with `include_archived: true`, matched by `plan_id` —
  the plan's **active version** (a grandfathered customer's archived plan is still found, see Known
  gaps). One lookup prices a whole page or delivery, alongside one `GET /v1/organization` for the
  currency.

**Which billing source counts.** An account's MRR comes from **Autumn** once its connection finished
its first import (`backfilledAt` set and the connection not disconnected), else from Stripe; the
other provider's subscriptions are ignored for MRR (`billingProviderOf`). Invoices always come from
Stripe. While Autumn's backfill is importing, or its history rebuild is pending, compute writes no
MRR movements: the rebuild after the backfill writes the year's history in one go.

## Syncing

| Phase           | Request                                                | Writes                                        | Requests |
| --------------- | ------------------------------------------------------ | --------------------------------------------- | -------- |
| `features`      | `POST /v1/features.list`                               | a metric definition per metered feature       | 1        |
| `customers`     | `POST /v1/customers.list` (100 a page, oldest first)   | accounts, seats, feature usage                | 1        |
| `subscriptions` | `POST /v1/subscriptions.list` (200 a page, all states) | subscriptions and MRR                         | 3        |

Every pull is a **full walk** of the organization's environment: no Autumn listing filters by a
change time (`customers.list` filters by *creation* time only), so `since` cannot narrow one. Ingest
writes only what actually changed, so an unchanged row never reaches the change log. Webhooks carry
the live signal; the walk is the reconciliation behind them, which is why its period is **6 hours**.
Because the customer phase lists every customer, the walk's last page sets `sweep: ["account"]` and
core removes the customers it did not see (deleted while no delivery reached Hazel) — only there,
never on an earlier page.

**Why subscriptions are a phase of their own.** A customer lists only the plans it holds *now* —
`active`, `past_due` and `scheduled` (`RELEVANT_STATUSES` in Autumn's server). A plan that ended is
invisible there, so a Hazel row left `active` would keep its MRR for ever.
`POST /v1/subscriptions.list` is the one read that reports `expired` rows too, across every customer,
with the customer each belongs to; asking it for all four states is what makes churn visible to a
pull.

**Paging** is Autumn's own opaque cursor (`start_cursor` → `next_cursor`), and the customer listing
asks for its oldest rows first (`sort_order: "asc"`), so a customer created mid-walk lands at the end
rather than shifting the rows not read yet. A keyset cursor cannot skip a row behind a deletion
either, so — unlike Clerk's offset paging — no page re-reads the one before it and there is no
`partial` walk. `subscriptions.list` may answer a short page (even an empty one) while `has_more` is
true, so the loop follows `has_more`, never the row count. The phase and cursor live on the run, so
an evicted object resumes where it stopped.

### Webhooks

A delivery says which customer changed; **Hazel reads its current state.** Autumn's payloads carry no
plan price, no subscription id for an expired plan and no balance figures, and deliveries arrive in
any order and are retried for days. So every delivery re-reads its customer the way a pull reads one
and writes that: deliveries applied in any order, or twice, land on the same state, and a webhook
writes exactly what a pull would.

| Event                            | Reads                                                                            | Writes                                     |
| -------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| `billing.updated`                | `customers.get`, then `plans.list` + `organization` (+ `subscriptions.list` when a plan expired) | the account, its plans, its feature usage  |
| `balances.limit_reached`         | the same, minus the expired lookup                                               | a `usage.limit_reached` entry + the usage  |
| `balances.usage_alert_triggered` | the same                                                                         | a `usage.limit_approaching` entry + usage  |

**Keeping another organization's — and another environment's — data out.** Autumn stamps a delivery
with neither: the envelope is `{ type, data }`. The customer read is the check. A secret key opens
exactly one organization *and* one environment, so a customer the key cannot see answers 404 and the
delivery is acknowledged with nothing written; one it can see carries `env`, which must be the
environment the key is for — a sandbox endpoint's signing secret pasted next to a live key is
**refused (400)**.

A read that fails is classified: a transient failure (unreachable, timed out, 429, 5xx) **refuses**
the delivery so Autumn delivers it again; a permanent one (the key lost its access) is logged and
acknowledged, and the next pull reports it on the connection. The reads are never retried in place
and give up after 5 s: a delivery must answer before Svix times out. An entity-scoped change
(`entity_id` set) writes nothing at all — it is a sub-customer's plan, not the account's — and costs
no request. An event type Hazel does not subscribe to is acknowledged without a request.

Usage entries are deduped on the delivery's own id — the envelope's `id` where Autumn sends one, else
Svix's `svix-id` — so a redelivery writes one entry.

### Failures

- **401/403** → `auth`: the connection goes to `error` and scheduled pulls stop until the key
  changes. The message carries Autumn's own explanation, truncated, with any quoted key removed.
- **429** → on a pull, waited out in place while the wait is short, then `rate_limited` carrying the
  delay; core keeps the run open at its cursor. Never waited out on the webhook path.
- **5xx**, unreachable or no answer in time → `provider` / `network`, both retryable: the run resumes
  after core's backoff.
- Any other **4xx** (a cursor Autumn no longer accepts) and a **body Hazel cannot read** → `provider`,
  not retryable: the run fails with a message saying so rather than retrying the same page for ever.
  Only the decode's path and issue kind are logged, never the payload.
- Eight failed attempts in a row at one cursor (rate limits aside) fail the run with a client-safe
  message and **no sweep**; the next scheduled pull starts a new run from the start.

## Known gaps

- **Prepaid and usage-based feature prices are not in the MRR.** A plan whose seats or credits are
  billed per unit on top of its base price reports only the base price. The units themselves *are*
  synced, as `autumn.<feature>` metrics with their limits, so `near_limit` and the usage charts see
  them — but an account on a $0-base, $10-per-seat plan shows an MRR of 0. Autumn reports the
  purchased quantity on the customer's balances rather than on the subscription, and pricing it would
  mean re-deriving tier maths (`graduated` / `volume`, `billing_units`, rollovers) that Autumn itself
  only settles at invoice time.
- **A plan version is not on a subscription**, so prices come from the plan's **active** version
  (archived plans are fetched, but a subscription names only its `plan_id`). A customer grandfathered
  on an older version of a plan whose price changed is reported at the current price. Autumn's API
  exposes no version on a customer's plan to disambiguate.
- **The reporting currency is the organization's `default_currency`.** A customer billed in another
  currency (Autumn stores a per-customer `currency`, but no API response exposes it) is reported at
  the base amount in the default currency, not its own `additional_currencies` amount.
- **Rewards and coupons are not applied.** Autumn's referral and reward redemptions do not appear on
  a customer's plan in the API, so `mrrMinor` is the plan's list price; `listMrrMinor` is the same
  value.
- **One-off purchases are not recorded.** `purchases[]` has no recurring amount, so it is no
  subscription; it is simply not read.
- **Entity-scoped plans and balances are skipped** (`scope: "entity"`, or an `entity_id` on a
  delivery): they belong to a sub-customer — a seat, a workspace — not the account.
- **No invoices.** Autumn invoices through Stripe, and Stripe is the invoice source
  (`tech-design.md` §4.2), so nothing here writes an invoice row — including the Stripe invoice an
  auto-top-up event carries, which is why `billing.auto_topup_succeeded` / `_failed` are not handled.
- **A `billing.updated` delivery costs two or three requests** (the customer, the pricing lookup,
  and `subscriptions.list` when a plan ended), cached nowhere, spending the organization's own Autumn
  rate limit. A 429 refuses the delivery and Autumn retries it later, so nothing is lost, but Hazel
  does not throttle or coalesce deliveries.
- **A customer's expired plans are read one page deep** on a delivery (200 rows). A customer with
  more ended plans than that has the rest reconciled by the next full walk, whose subscription phase
  lists every row of the organization.
- **An unlimited feature has no `limitValue`**, so `near_limit` never fires on it — correctly, there
  is no limit to be near — and neither does a feature the plan grants nothing of.
- **A feature's `next_reset_at` is not stored.** A metric is the day's level of the current period;
  the day a consumable feature resets looks like a drop in the series rather than a new period.
