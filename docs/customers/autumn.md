# Autumn data source

The **MRR source of every account it bills**, once its first import finished: an Autumn customer
lands on the account an identity source already created, the **plans** it holds become the MRR, the
plan name, the trial and the payment state, and its **feature balances** become the daily usage
metrics and plan limits the `near_limit` signal reads. Stripe keeps the invoices either way, and the
MRR of an account Autumn bills nothing (no plan, or only a free one; `tech-design.md` §4.2).
Adapter: `apps/backend/src/worker/objects/customers/autumn/`, registered in `customers/providers.ts`.
It produces `IngestOp`s only — `CustomerIngest` does every write (`tech-design.md` §3).

Autumn never creates a customer record on its own (`onNoMatch: "unmatched"`). It lands on one of
three ways, first hit wins (`tech-design.md` §3):

1. its own external ref, from a previous sync;
2. a **shared id** — the Autumn customer id _is_ the Clerk organization id. This is the whole
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
   of each resource Hazel needs (the organization and its currency, plans, features, customers,
   subscriptions), so a key that cannot reach one says so at connect time instead of failing the
   first backfill. A key whose prefix is neither is refused before any request.

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
picks the version from the _organization's creation date_ (`apiVersionMiddleware`), so the same
request would answer in different shapes for different Hazel customers.

## Mapping

| Autumn                                                       | Hazel                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| customer `id`                                                | account external ref `(autumn, <id>)`                   |
| customer `id`, with the toggle on                            | `sameAs` → the Clerk account (`matchMethod: shared_id`) |
| customer `email` domain, with the toggle off                 | a domain match                                          |
| customer `name`                                              | `account.name` (Clerk's wins, `FIELD_PRECEDENCE`)       |
| customer `created_at`                                        | `account.firstSeenAt` if earlier                        |
| customer `licenses[].granted` / `.usage` (summed)            | `account.seatsLimit` / `seatsUsed` (outranks Clerk's)   |
| customer gone from a full walk                               | ref goes stale; account soft-deleted with no live ref   |
| plan gone from a full walk (its customer deleted)            | `subscription.status = canceled` (core's sweep)         |
| `<customer id>:<subscription id>`                            | `subscription.externalId`                               |
| plan `price.amount × quantity` + prepaid units, per interval | `subscription.mrrMinor` (see below)                     |
| plan `name` (else the `plan_id`)                             | `subscription.planName`                                 |
| `past_due`, `trial_ends_at`, `expired`                       | `subscription.status` (see below)                       |
| subscription `started_at`                                    | `subscription.startedAt`                                |
| subscription `trial_ends_at`                                 | `subscription.trialEndsAt`                              |
| `current_period_end`, else `expires_at`                      | `subscription.currentPeriodEnd`                         |
| `canceled_at` on a plan still running (not a downgrade)      | `cancelAtPeriodEnd`, `canceledAt`                       |
| balance `usage`                                              | `metric_daily.value` for `autumn.<feature_id>`          |
| balance `granted` (not unlimited, > 0)                       | `metric_daily.limitValue` — what `near_limit` measures  |
| feature `name`                                               | the metric definition's name (`aggregation: max`)       |
| `balances.limit_reached`                                     | timeline `usage.limit_reached`                          |
| `balances.usage_alert_triggered`                             | timeline `usage.limit_approaching`                      |

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

| Autumn                | Hazel       |
| --------------------- | ----------- |
| `past_due: true`      | `past_due`  |
| `trial_ends_at` set   | `trialing`  |
| otherwise active      | `active`    |
| `status: "expired"`   | `canceled`  |
| `status: "scheduled"` | **skipped** |

A `scheduled` plan is skipped: it bills nothing yet, Hazel's model has no scheduled status, and
recording it as active would count a future plan's amount as MRR today. A **downgrade** is a
scheduled paid base plan (not an add-on, not `auto_enable`, with MRR, a usage price or a recurring
`prepaid` item at any price; one-off packs are no recurring price) in the
current plan's `group`, which Autumn marks `canceled_at`: that is a plan change, not a cancellation,
so the current plan keeps `cancelAtPeriodEnd` false (no `cancel_scheduled` entry, no false churn)
and ingest sees the change when the new plan starts. Canceling a plan at the period's end also
schedules a plan — its group's free `auto_enable` one (`scheduleDefaultProduct`) — and that is a
cancellation: the current plan gets `cancelAtPeriodEnd`.
Hazel's `unpaid` and `paused` have no Autumn equivalent and are never written by this source.

**Subscription ids.** Autumn's id is the app's own `subscription_id` (else Autumn's), unique only
among one customer's live plans: another customer may use the same one, and a customer may reuse an
ended plan's. So the external id is `<customer id>:<subscription id>`, and when a read holds an ended
and a live plan under one id, the live one is written.

**Ordering.** Every op carries `observedAt`, the time taken before its read (Autumn's records carry
no `updated_at`). Ingest keeps the newest one applied per subscription and drops an older read, so a
slow delivery or pull page cannot overwrite what a newer one wrote, and a late delivery cannot revive
a customer deleted since. It is also what the walk's plan sweep reads: a plan not read since the run
started is gone.

**No contacts.** Autumn holds no users of its own — a customer is the company — so this source
writes no contacts and its walk never sweeps them, only accounts and plans.

### MRR

`mrrMinor` is a **monthly** amount in the currency's **minor units**. Autumn quotes amounts in
**major** units ("in major currency units (e.g. dollars)") of the organization's
`default_currency`, so the amount is scaled by that currency's minor-unit factor — 100 normally, 1
for a zero-decimal currency (JPY, KRW …), 1000 for a three-decimal one — taken from the same Stripe
currency table Autumn bills through.

- Per subscription: the plan's **base price** `amount × quantity`, normalized to a month —
  `/month` as it is, `/year ÷ 12`, `/quarter ÷ 3`, `/semi_annual ÷ 6`, `/week × 52/12`, each divided
  by the price's `interval_count`. A missing quantity counts as one.
- Plus the **prepaid units** bought on top of the plan (seats, credit packs): Autumn reports them on
  the customer's balances, not the subscription. Each `balances[].breakdown[]` grant of the plan
  with a `prepaid` price adds `prepaid_grant ÷ billing_units × amount`, at the cadence of the plan
  item's price. A sub-customer's grant (`source: "entity"`) and a tiered price (no flat `amount`)
  add nothing. A grant names its plan, not its subscription: a customer holding one plan twice has
  the plan's grants split evenly between the two (their sum is right), and an ended plan gets none
  (its grants are gone from the balances).
- A **`usage_based`** item adds nothing: it bills after the period for what was used and is not
  knowable in advance (Stripe's metered prices are left out the same way). A plan billed only that
  way, a `one_off` base price, or a plan with no price at all (Autumn's free tier) is **MRR 0**. See
  Known gaps.
- A **plan no processor ever billed** (no `current_period_end`) is MRR 0 and never `billsByUsage`:
  an ended one (a trial that lapsed unconverted), or a live one past a card-less trial Autumn has
  not converted yet (no `trial_ends_at` left, the plan has a `free_trial`). An account whose only
  plan was that trial reads as a `lead`, not `active` or `churned` (compute calls an account churned
  when a canceled subscription had MRR or billed by usage). A live plan without a trial and without
  a billing period keeps its price: Autumn attaches a paid plan billed outside Stripe that way
  (`no_billing_changes`). The billing period is Autumn's mirror of the processor's subscription (its
  `subscriptions` row, `getApiSubscription`): a billed plan whose mirror row is missing reads as
  never billed too.
- An **ended plan that ended within its trial** is MRR 0 too, and sends that trial's end as
  `trialEndsAt`: a card trial canceled before it converted has a billing period (the trial's), and
  Autumn reports `trial_ends_at` only while a trial runs. The end comes from the plan's
  `free_trial` terms and the plan's `started_at` by calendar in UTC (days, months, years; a month
  from the 31st ends on the next month's last day), plus the ten minutes Autumn adds and an hour's
  slack. A customer Autumn gave no trial (one it already used) whose plan ends within the trial's
  length reads as never billed as well; see Known gaps for a trial as long as the billing interval.
- A **live plan whose trial converted** sends the trial's end as `trialEndsAt`, so its account's
  `customerSince` and MRR history leave the trial days out: Autumn clears `trial_ends_at` on
  conversion and reports no conversion date. A plan with a `free_trial` whose billing period
  (`current_period_start`) starts at or after the trial's end (from the terms, as above) converted;
  the end is that period's start while it is the first paid one, else the terms' end.
- A **`past_due` plan with prepaid items and no grant in the balances**, or held twice by the
  customer, sends no `mrrMinor` (nor `listMrrMinor`, `billsByUsage`) for any live holding of it, and
  ingest keeps the stored MRR: Autumn's balances carry only active plans' grants unless the
  organization counts past_due ones (`include_past_due`), so the read cannot price its prepaid units,
  and a grant names no holding, so a shared pool may lack the past_due one's. A plan first seen that
  way is stored at MRR 0.
- Prices are the **customer's own**: both customer reads expand each live plan
  (`expand: ["subscriptions.plan"]`), which carries a custom price and the version the customer is
  on. An ended plan (from `subscriptions.list`, which cannot expand) is priced from
  `POST /v1/plans.list` with `include_archived: true` — the plan's **active version**, which only
  matters for its account's churn check.
- `listMrrMinor` equals `mrrMinor`: the customer's own plan already carries any custom price, and
  Autumn exposes no separate list price.
- The amount is rounded once, at the end, and never goes below zero.
- `mrrMinor` is what the plan bills **or would bill**, whatever its status: compute decides which
  statuses count towards an account's MRR (`tech-design.md` §4.2).
- The plans and the currency (`GET /v1/organization`) are kept **5 minutes per connection** in the
  isolate's memory, so a walk or a burst of deliveries reads them about once.

**Which billing source counts.** Per account (`billingProviderOf`): an account with Autumn
subscriptions and none in Stripe takes Autumn's, whatever the connection's state, so a disconnect
does not zero its MRR. An account with both takes **Autumn's** once its connection finished its
first import (`backfilledAt` set, not disconnected, and after a reconnect a run started since
succeeded: what it imported before is stale until then) **and** Autumn bills it now (an `active`,
`past_due` or `unpaid` subscription with MRR or `billsByUsage`), else Stripe's when Stripe does — an
auto-enabled free Autumn plan or an Autumn trial does not take billing over from Stripe. With
neither billing now, the source the account had (so a payer whose billing ends in one provider
churns there instead of switching); an account with none yet takes the one that paid, Stripe's
first. An account with no Autumn subscription takes Stripe's. The other provider's subscriptions
are ignored for that account's MRR. A switch of source writes no MRR movement (a migration, not
revenue) only when the new source bills the account now in the reporting currency and its MRR was
above 0; a switch from MRR
0 (an upgrade from a free Autumn plan that Stripe reports first) writes its movement.
Invoices always come from Stripe. While Autumn's backfill is importing, compute writes no MRR
movement for an account whose source is, or was last run, Autumn (Stripe's accounts keep theirs),
and none at all while its history rebuild is pending: the rebuild after the backfill writes the
year's history in one go.

## Syncing

| Phase           | Request                                                              | Writes                                             | Requests |
| --------------- | -------------------------------------------------------------------- | -------------------------------------------------- | -------- |
| `features`      | `POST /v1/features.list`                                             | a metric definition per metered feature            | 1        |
| `customers`     | `POST /v1/customers.list` (100 a page, oldest first, plans expanded) | accounts, seats, feature usage, live plans and MRR | 1 (+2)   |
| `subscriptions` | `POST /v1/subscriptions.list` (200 a page, all states)               | ended plans                                        | 1 (+2)   |

(+2: the pricing lookup, `plans.list` + `organization`, when the page has a plan to price and the
connection's pricing is not cached.)

Every pull is a **full walk** of the organization's environment: no Autumn listing filters by a
change time (`customers.list` filters by _creation_ time only), so `since` cannot narrow one. Ingest
writes only what actually changed, so an unchanged row never reaches the change log. Webhooks carry
the live signal; the walk is the reconciliation behind them, which is why its period is **6 hours**.

**Live plans come with their customer.** The customer listing takes the same `expand` as
`customers.get` (Autumn reads it off any request body), so each live plan arrives as the customer
holds it, beside the balances that carry its prepaid units — priced exactly as a delivery prices it,
so a pull never undoes a delivery's MRR.

**Ended plans are a phase of their own.** A customer lists only the plans it holds _now_ —
`active`, `past_due` and `scheduled` (`RELEVANT_STATUSES` in Autumn's server). A plan that ended is
invisible there, so a Hazel row left `active` would keep its MRR for ever.
`POST /v1/subscriptions.list` reports `expired` rows too, across every customer, each customer's
rows together, newest first. It is asked for every state so that an ended plan whose id a live one
reuses is recognised and left alone; only ended plans are written from it. A customer's rows may
straddle a page boundary, so the cursor carries the page's last customer and its live plan ids into
the next page. A row whose `customer_id` is Autumn's internal id (`cus_` and a KSUID: the listing
names it for a customer without an id of its own) is skipped, as the customer phase skipped that
customer.

**Sweep.** The walk's last page sets `sweep: ["account", "subscription"]`: core removes the
customers the walk did not see and cancels the plans it did not read (`observedAt` older than the
run) — a customer deleted in Autumn, for which Autumn sends no webhook, loses its MRR within one
walk. Core caps every sweep (a type whose removals would exceed 20% of the provider's live records
and 10 records is not swept). The walk itself leaves out what it could not list completely, with a
warning logged:

- **no sweep at all** when a customer page comes without `next_cursor` and its last customer has no
  `created_at`. Autumn drops the cursor on any page ending on an id-less customer
  (`CusBatchService.getCursorPage`), more customers or not, and it takes the cursor before it drops
  the customers it fails to serialize, so the last customer listed need not be the page's last. It
  lists by creation time, then id with the id-less last, so every page without a cursor is
  confirmed: the walk goes on from the millisecond after its last listed customer's creation
  (`created_at_range.start`), and only an empty page is the real end;
- **no sweep at all** when a customer page lists fewer customers than asked for and more follow it
  (a `next_cursor`, or a page without one followed by a non-empty one): Autumn logged and dropped a
  customer it failed to serialize, and that customer must not be removed;
- **no sweep of a listing** with a row Hazel cannot decode: the row is logged (phase and count only)
  and skipped rather than failing the page, the same row failing every retry;
- **no plan sweep** when a customer lists 15 plans (subscriptions and purchases): that is how many a
  listing returns per customer by default (`DEFAULT_CUS_PRODUCT_LIMIT`), so more may exist; or when a
  subscriptions page says `has_more` without a cursor.

**Paging** is Autumn's own opaque cursor (`start_cursor` → `next_cursor`), and the customer listing
asks for its oldest rows first (`sort_order: "asc"`), so a customer created mid-walk lands at the end
rather than shifting the rows not read yet. A keyset cursor cannot skip a row behind a deletion
either, so — unlike Clerk's offset paging — no page re-reads the one before it.
`subscriptions.list` may answer a short page (even an empty one) while `has_more` is true, so the
loop follows `has_more`, never the row count. The phase and cursor (and what the walk will not
sweep) live on the run, so an evicted object resumes where it stopped.

### Webhooks

A delivery says which customer changed; **Hazel reads its current state.** Autumn's payloads carry no
plan price, no subscription id for an expired plan and no balance figures, and deliveries arrive in
any order and are retried for days. So every delivery re-reads its customer the way a pull reads one
and writes that: deliveries applied in any order, or twice, land on the same state, and a webhook
writes exactly what a pull would.

| Event                            | Reads                                                                                | Writes                                       |
| -------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| `billing.updated`                | `customers.get`, alongside `subscriptions.list` (the ended plan) when a plan expired | the account, its plans, its feature usage    |
| `balances.limit_reached`         | `customers.get`                                                                      | a `usage.limit_reached` entry + the same     |
| `balances.usage_alert_triggered` | `customers.get`                                                                      | a `usage.limit_approaching` entry + the same |

Plus the pricing lookup when it is not cached (see MRR). `customers.get` expands the balances'
features and the customer's own plans.

**Keeping another organization's — and another environment's — data out.** Autumn stamps a delivery
with neither: the envelope is `{ type, data }`. The customer read is the check. A secret key opens
exactly one organization _and_ one environment, so a customer the key cannot see answers 404 and the
delivery is acknowledged with nothing written. Everything written comes from that read — so a
delivery from a sandbox endpoint whose signing secret was pasted next to a live key either writes
nothing (no live customer of that id) or re-reads the **live** customer of the same id and writes
its live state. The one exception is a usage entry: its feature and limit come from the payload, so
a sandbox limit event can land on the live account of the same id (see Known gaps). The read's own
`env` check (a customer of the other environment is refused, 400) is a backstop; a key never returns
one.

**A deleted customer** answers 404 like an unknown one, so its delivery writes nothing. The adapter
holds no state to know that customer's plans; the next walk's sweep removes the customer and cancels
its plans.

A read that fails is classified: a transient failure (unreachable, timed out, 429, 5xx) **refuses**
the delivery so Autumn delivers it again; a permanent one (the key lost its access) is logged and
acknowledged, and the next pull reports it on the connection. The reads are never retried in place
and give up after 5 s: a delivery must answer before Svix times out. An entity-scoped change or
limit (`entity_id` set) writes nothing at all — it is a sub-customer's, not the account's — and
costs no request. An event type Hazel does not subscribe to is acknowledged without a request.

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

- **Usage-based prices are not in the MRR.** A plan billed only per unit used (a `$0` base with a
  `usage_based` item) reports MRR 0: the amount is not knowable before the period's invoice. The
  subscription is marked `billsByUsage`, so its account still reads as paying (`active`, with
  `customerSince`; `churned` once the plan ends), but it adds nothing to the MRR, its movements or
  the paying-accounts count. The usage _is_ synced, as `autumn.<feature>` metrics. A plan with a
  base price or flat prepaid units is not marked: its MRR already makes it paying, and its usage
  overage is left out.
- **Tiered prepaid prices** (graduated / volume, no flat `amount`) add nothing to the MRR. Units
  bought at one on a plan with no other MRR mark the subscription `billsByUsage` like a usage price.
- **Ended plans are priced from the plan's active version**: `subscriptions.list` cannot expand a
  row's own plan. It only feeds the churn check (a canceled plan with MRR), never the MRR itself.
- **The reporting currency is the organization's `default_currency`.** A customer billed in another
  currency (Autumn stores a per-customer `currency`, but no API response exposes it) is reported at
  the base amount in the default currency, not its own `additional_currencies` amount.
- **Rewards and coupons are not applied.** Autumn's referral and reward redemptions do not appear on
  a customer's plan in the API, so `mrrMinor` is the plan's price.
- **One-off purchases are not recorded.** `purchases[]` has no recurring amount, so it is no
  subscription; it is only counted against the per-customer listing cap.
- **Entity-scoped plans and balances are skipped** (`scope: "entity"`, or an `entity_id` on a
  delivery): they belong to a sub-customer — a seat, a workspace — not the account.
- **No invoices.** Autumn invoices through Stripe, and Stripe is the invoice source
  (`tech-design.md` §4.2), so nothing here writes an invoice row — including the Stripe invoice an
  auto-top-up event carries, which is why `billing.auto_topup_succeeded` / `_failed` are not handled.
- **Organizations billed through another (Maple's sub-orgs).** An app can bill one organization's
  usage through another's Autumn customer and cancel the first one's own plans (Maple's
  `billedThroughAnother`, a link held in the app's database). Hazel sees those plans end as churn and
  the paying organization's MRR grow. Telling the two apart needs the link as a signal Hazel can read
  — e.g. the paying customer's id in the Autumn customer's `metadata`, or on the Clerk organization —
  which neither exposes today.
- **A sandbox signing secret next to a live key** can attach a sandbox `balances.limit_reached` /
  `usage_alert_triggered` entry to the live account sharing its customer id (with the shared Clerk
  organization id, sandbox and live customers often do). Plans, usage and seats are always re-read
  with the key, so only those timeline entries can be wrong. Autumn's envelope carries no
  environment to check.
- **Seats are not cleared** when a customer's licenses go away: an op without seats leaves the last
  ones Autumn wrote. Sending `null` would make Autumn the owner of the field (`FIELD_PRECEDENCE`) for
  every account without licenses and hide Clerk's member count for good; clearing needs a core way
  for a source to release a field.
- **A trial as long as the billing interval is ambiguous once the plan ended.** The trial's end of
  an ended plan is derived (`started_at` + the plan's `free_trial`), since Autumn clears
  `trial_ends_at`; Autumn's API does not say whether the customer was given the trial. When the
  trial is as long as the billing interval (a month's trial on a monthly plan), a customer given no
  trial (one already used) who paid one period and canceled at its end ends exactly when the trial
  would have, and reads as never billed (a lead, MRR 0) rather than churned.
- **A customer Autumn cannot serialize at the true end of the listing is swept.** The walk detects a
  dropped customer only by a short page with more after it. A customer Autumn fails to serialize
  that was created after every customer it lists is dropped from the last page and from the
  confirmation page alike, so the empty confirmation reads as the real end and the sweep removes it
  (within core's sweep cap) until it serializes again.
- **A customer created between the last page and its confirmation skips the sweep.** A short last
  page without a cursor is confirmed by listing from the millisecond after its last customer; a
  customer created in between lands on that confirmation page, which then looks like a dropped
  customer (a short page with more after it), so that walk sweeps nothing. Deleted customers wait for
  the next walk.
- **A plan with a trial renewed by a customer given no trial reads as a converted trial.** Autumn's
  API does not say whether the customer was given the trial (one already used is not), so once such
  a plan's billing period starts past the trial's length, its first trial-length of days drop out of
  `customerSince` and the MRR history.
- **The rebuilt history takes each account's current billing source only.** The year of MRR history
  rebuilt after a backfill reads the subscriptions of the source the account bills from now: an
  account that moved from Stripe to Autumn gets its history from Autumn's plans alone, so its
  Stripe-billed months before the move are missing (its history starts at the Autumn plan). Movements
  computed before the rebuild are kept, and an account with any is not rebuilt.
- **Usage entries are dated by receipt.** `balances.*` deliveries carry no event time (Autumn sends
  them without `occurred_at`, and `svix-timestamp` is each attempt's), so a redelivered entry is
  dated when it finally arrived.
- **A `billing.updated` delivery costs one or two requests** (the customer, and its ended plans when
  one expired, side by side), plus the pricing lookup once per five minutes. A 429 refuses the
  delivery and Autumn retries it later, so nothing is lost, but Hazel does not throttle or coalesce
  deliveries.
- **A customer's expired plans are read one page deep** on a delivery (200 rows, of the plan that
  ended when the delivery names one). The rest are reconciled by the next full walk.
- **A customer listing more than 15 plans** has the rest cut by Autumn's listing, so their plans keep
  their last state until a delivery, and that walk does not sweep plans. Autumn can override the cap
  per organization (`maxCusProducts`, an admin setting no API exposes). A higher one only makes Hazel
  skip plan sweeps it could have run. A lower one goes unnoticed: a customer cut below 15 plans
  looks complete, and the sweep cancels the plans it did not list.
- **An unlimited feature has no `limitValue`**, so `near_limit` never fires on it — correctly, there
  is no limit to be near — and neither does a feature the plan grants nothing of.
- **Id-less customers' rows are recognised by shape.** `subscriptions.list` names Autumn's internal
  id for a customer without one of its own; a `customer_id` that looks like one (`cus_` and 27
  base-62 characters) is skipped. An app whose own customer ids take that shape has those
  customers' ended plans skipped too (their live plans are read with the customer).
- **An upgrade can count twice within one walk.** A pull writes a customer's new plan in its
  customer phase, and the plan it replaced ends only in the subscription phase pages later; a
  compute in between counts both. The next compute settles it, and the same day's movements merge.
  A `billing.updated` delivery reads both at once and does not have the gap.
- **A feature's `next_reset_at` is not stored.** A metric is the day's level of the current period;
  the day a consumable feature resets looks like a drop in the series rather than a new period.
