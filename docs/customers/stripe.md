# Stripe data source

Hazel's billing source for Customers: a Stripe **customer** lands on the account an identity source
already created, and its **subscriptions** and **invoices** become the MRR, the plan, the trial and
the payment state that the billing signals (`payment_failed`, `cancel_scheduled`,
`trial_ending_low_activation`) and the health score's billing component read. Adapter:
`apps/backend/src/worker/objects/customers/stripe/`, registered in `customers/providers.ts`. It
produces `IngestOp`s only — `CustomerIngest` does every write (`tech-design.md` §3).

Stripe never creates a customer record on its own (`onNoMatch: "unmatched"`). It lands on one of
three ways, first hit wins (`tech-design.md` §3):

1. its own external ref, from a previous sync;
2. a **shared id** — the Clerk organization id in the customer's metadata;
3. the **domain** of the customer's email, when the connection matches by domain.

Anything else waits in the unmatched list, holding its op, and ingest replays it the moment someone
links it.

## Setting it up

1. **Restricted key** — Stripe Dashboard → Developers → **API keys** → _Create restricted key_,
   with **Read** on:

    | Resource        | Why                                                        |
    | --------------- | ---------------------------------------------------------- |
    | Customers       | the accounts and their billing contacts                    |
    | Subscriptions   | MRR, plan, status, trial, scheduled cancellation           |
    | Invoices        | amounts, due dates, failed payments, the hosted copy       |
    | Products        | the plan names (a price only carries its product's id)     |
    | Prices          | the amounts and intervals embedded in a subscription       |
    | Payment methods | the card brand, last four and expiry on file               |

    Everything else can stay **None**; Hazel only ever issues GETs. A full secret key works too.
    Connecting reads one record of each resource, so a key missing a permission says which one at
    connect time instead of failing the first backfill. The Stripe **account** itself
    (`GET /v1/account`) is read best-effort: its id is stored as the connection's
    `externalAccountId` and webhook deliveries are checked against it, and without that permission
    the connection still works (deliveries are then only checked against the key's mode).

2. **Webhook** — Stripe Dashboard → Developers → **Webhooks** → add an endpoint:

    ```
    POST https://<api host>/webhooks/customers/stripe/<organizationId>/<connectionId>
    ```

    The data-sources page shows the exact URL once the connection exists (the ids are in the path,
    the signature is the auth). Subscribe:

    `customer.created`, `customer.updated`, `customer.deleted`,
    `customer.subscription.created`, `customer.subscription.updated`,
    `customer.subscription.deleted`, `customer.subscription.paused`,
    `customer.subscription.resumed`, `customer.subscription.trial_will_end`, `invoice.created`,
    `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`,
    `invoice.payment_action_required`, `invoice.voided`, `invoice.marked_uncollectible`,
    `payment_method.attached`, `payment_method.updated`

3. Paste the endpoint's **signing secret** (`whsec_…`) into the connect form. Both secrets are
   stored encrypted in `customer_connection_secrets` and decrypted only to call Stripe or verify a
   delivery.

Every request pins `Stripe-Version: 2025-08-27.basil`, so a Dashboard upgrade cannot change the
wire shape under Hazel. A webhook endpoint delivers in **its own** pinned version, which is rarely
the same one, so the schemas read both places of everything that moved between versions (the
subscription period, the invoice's subscription, a discount's coupon).

### Matching Autumn-managed accounts

Maple's Stripe customers are created by **Autumn**, which writes the Autumn customer id into the
Stripe customer's `metadata` — and that id is the Clerk organization id. So besides the configured
metadata key (`clerk_org_id` by default), Hazel reads **any** metadata value shaped like a Clerk
organization id (`org_…`) as a shared id, whatever key it sits under. An Autumn-managed account
therefore matches with no configuration, and a stray `org_…` value costs one lookup that finds
nothing. Metadata naming two ids that resolve to two *different* customers is ambiguous: ingest
parks the record with the first as its suggestion rather than guessing (`tech-design.md` §3).

## Mapping

| Stripe                                                     | Hazel                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| customer `id`                                              | account external ref `(stripe, cus_…)`                       |
| customer `metadata[clerkOrgMetadataKey]`, any `org_…` value | `sameAs` → the Clerk account (`matchMethod: shared_id`)      |
| customer `email` domain                                    | `account.domains`, and a domain match when the toggle is on  |
| customer `name`                                            | `account.name` (Clerk's wins, `FIELD_PRECEDENCE`)            |
| customer `created`                                         | `account.firstSeenAt` if earlier                             |
| customer `email`                                           | a contact with `isBillingContact`, keyed on the customer id  |
| customer deleted                                           | ref goes stale; account soft-deleted with no live ref left   |
| subscription `items[].price × quantity`, per interval       | `subscription.mrrMinor` (see below)                          |
| subscription coupons                                       | applied to `mrrMinor`; `listMrrMinor` keeps the list price   |
| price's product `name` (else `nickname`, `lookup_key`)     | `subscription.planName`                                      |
| subscription `status`                                      | `subscription.status`                                        |
| subscription `start_date`, `trial_end`, period end         | `startedAt`, `trialEndsAt`, `currentPeriodEnd`               |
| `cancel_at_period_end`, `canceled_at`                      | `cancelAtPeriodEnd`, `canceledAt`                            |
| `cancellation_details.reason` (else `feedback`)            | `subscription.cancellationReason`                            |
| `default_payment_method` (expanded)                        | card brand, last four, expiry month and year                 |
| invoice `status`, `number`, `amount_due`, `amount_paid`    | the invoice row                                              |
| invoice `due_date`, `next_payment_attempt`                 | `dueAt`, `nextRetryAt`                                       |
| invoice `status_transitions.finalized_at` / `paid_at`      | `issuedAt`, `paidAt`                                         |
| invoice `attempt_count`, `hosted_invoice_url`              | `attemptCount`, `hostedUrl`                                  |
| invoice's subscription (`parent.subscription_details`)      | the invoice's subscription                                   |

Ingest raises the timeline entries itself — `subscription.started`, `subscription.plan_changed`,
`subscription.cancel_scheduled`, `subscription.canceled`, `invoice.paid`,
`invoice.payment_failed` — from the state changes these ops describe, so the adapter emits no
event ops of its own.

**Statuses.** `trialing`, `active`, `past_due`, `unpaid`, `paused` and `canceled` map across.
`incomplete_expired` is a subscription Stripe will never bill: `canceled`. An `incomplete` one
(a first payment that never went through) is **skipped** until it goes `active`, so an abandoned
checkout raises no `payment_failed` signal. A status Stripe adds later is skipped rather than
guessed at, and the next pull picks it up once the mapping knows it.

**No contact sweep.** Stripe writes one contact per customer, and ingest merges it into the
account's existing contact with that email — usually the Clerk member. Removing Stripe's contact ref
would soft-delete that person, so a Stripe pull never sweeps contacts, only accounts.

### MRR

`mrrMinor` is a **monthly** amount in the currency's **minor units**, which is what Stripe already
sends (`unit_amount`), so nothing is multiplied or divided by 100 anywhere and a zero-decimal
currency like JPY is right by construction.

- Per subscription item: `unit_amount × quantity`, normalized to a month — `/month` as it is,
  `/year ÷ 12`, `/week × 52/12`, `/day × 365/12`, each divided by the price's `interval_count`.
  A missing quantity counts as one. A sub-cent price is read off `unit_amount_decimal`.
- Items Stripe states no amount for — a **metered** price, a **tiered** one — count as nothing:
  what they will bill is not knowable before the invoice. Autumn's usage-based features are read as
  metrics by the Autumn source, not guessed at here.
- Items are summed, then the subscription's coupons are applied: a `percent_off` always, an
  `amount_off` only in the subscription's own currency, spread over the primary item's cadence
  (1 200.00 off a yearly subscription is 100.00 a month). The sum before discounts stays as
  `listMrrMinor`, which is what a trial is ranked by (`trialListMrrMinor`, `tech-design.md` §4.6).
  An unexpanded discount (a bare id) says nothing about the amount and is ignored.
- The amount is rounded once, at the end, and never goes below zero.
- `mrrMinor` is what the subscription bills **or would bill**, whatever its status: compute decides
  which statuses count towards an account's MRR (`active`, `past_due`, `unpaid`), reads a trial's
  list price for ranking, and needs a canceled subscription's amount to recognise the churn
  (`tech-design.md` §4.2).
- The plan name, interval and quantity come from the item that carries most of the amount.

## Syncing

| Phase           | Request                                  | Writes                                     |
| --------------- | ---------------------------------------- | ------------------------------------------ |
| `customers`     | `/v1/customers`                          | accounts and their billing contacts        |
| `products`      | `/v1/products`                           | nothing: it gathers the plan names         |
| `subscriptions` | `/v1/subscriptions?status=all` (expanded) | subscriptions and MRR                      |
| `invoices`      | `/v1/invoices`                           | invoices                                   |

Paging is Stripe's own `starting_after`, which is id-based, so a record deleted mid-walk cannot
shift a page past another one and no page has to re-read the one before it. The phase, the cursor
and the product names live in the run's cursor, so an evicted object resumes where it stopped.

The `products` phase exists because a product's name is five levels deep from a subscription list
(`data.items.data.price.product`) and Stripe expands four. The names are gathered once per pull and
carried in the cursor; past 300 products it stops collecting and those subscriptions fall back to
their price's nickname.

- **The backfill (`since: null`) lists everything**, so its last page sets
  `PullPage.sweep = ["account"]` and core removes the customers it did not see (deleted while no
  webhook reached Hazel). Invoices are bounded to the last 365 days: nothing older answers a signal
  or a rollup, and a decade of invoices cannot stall a connection.
- **A scheduled pull (every 6 hours) is incremental.** None of Stripe's list endpoints filter by a
  change time, only by `created`, so it asks for what was created since the last success (minus
  core's overlap) and never sets `sweep`. Changes to older records ride on the webhooks; the
  backfill is the one complete reconciliation.

Deliveries are verified with Stripe's scheme (`stripe/signature.ts`): HMAC-SHA256, hex, over
`${timestamp}.${rawBody}`, keyed with the endpoint's signing secret **as Stripe shows it** — the
`whsec_` prefix included, unlike Svix, where the secret is base64 after its prefix. Several `v1`
signatures appear while an endpoint's secret is being rolled and any one matching is enough; every
other scheme is ignored (Stripe sends a deliberately wrong `v0` on test-mode events). A timestamp
outside ±5 minutes is refused, so a captured delivery cannot be replayed, and the comparison is
constant-time. An event from another connected account than the key opens, or from the other mode
(the key's prefix says which), is refused too — so a test-mode endpoint's secret next to a live key
cannot write test data into a production connection.

Refused deliveries are answered 400. Stripe retries a non-2xx with backoff for up to three days, so
the adapter refuses only what a retry cannot fix (signature, replay window, a payload that does not
decode, the wrong account or mode) and acknowledges every event type it does not handle.

Failures: 401 → `auth` (the run fails, the connection goes to `error`, pulls stop until the key
changes); 403 → `auth` too, naming the route the restricted key may not read; 429 → waited out in
place while the delay is ≤ 5 s, otherwise `rate_limited` with that delay; 5xx → `provider`;
unreachable → `network`. Those are retryable: the run stays `running` at its cursor and the next
attempt resumes from the failed page. A body that does not decode (Stripe changed its API) is a
`provider` error that is **not** retried: the run fails with a message saying so, and the decode
failure is logged by path and issue kind only, never with the payload.

## Known gaps

- **A subscription webhook costs one extra request.** The plan name is the Stripe product's, and a
  subscription payload carries only the product's id, so every delivery that writes a subscription
  fetches it (at most 5 per delivery, cached nowhere). If that request fails the delivery is still
  acknowledged with the price's nickname instead — and if there is none, the plan name is cleared
  until the next pull restores it.
- **`payment_method.*` names no subscription**, so it lists the customer's
  (`GET /v1/subscriptions?customer=…`) to write the card against them. A customer with no
  subscription writes nothing.
- **The decline reason** Stripe shows lives on the invoice's payment intent, which Hazel does not
  read (it would need another permission). An `invoice.payment_failed` delivery therefore records
  "Stripe could not collect this payment" unless Stripe put a message on the invoice itself — which
  is also what lets ingest raise `invoice.payment_failed` on the *first* attempt, where
  `attempt_count` is still 1.
- **`invoice.upcoming` is not handled.** Stripe's preview has no invoice id, and nothing in Hazel
  reads an `upcoming` invoice yet (the status exists in the model for a provider that does).
- **Metered and tiered prices contribute no MRR** (see above), so an account billed purely by usage
  through Stripe shows an MRR of 0. Usage belongs to the Autumn and Maple sources.
- **A customer has no `updated` timestamp** in Stripe, so account ops are ordered by the event's
  own time (and by the request time on a pull). Two deliveries inside the same second order by
  arrival.
- **Credit notes and refunds** are not read: an invoice's amounts are what Stripe reports on it.
