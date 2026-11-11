# Stripe data source

Hazel's billing source for Customers: a Stripe **customer** lands on the account an identity source
already created, and its **subscriptions** and **invoices** become the MRR, the plan, the trial and
the payment state that the billing signals (`payment_failed`, `cancel_scheduled`,
`trial_ending_low_activation`) and the health score's billing component read. Adapter:
`apps/backend/src/worker/objects/customers/stripe/`, registered in `customers/providers.ts`. It
produces `IngestOp`s only — `CustomerIngest` does every write (`tech-design.md` §3).

Stripe never creates a customer record on its own (`onNoMatch: "unmatched"`), and its account ops
set `matchByDomain` only while the connection's **Email domain** toggle is on. It lands on one of
three ways, first hit wins (`tech-design.md` §3):

1. its own external ref, from a previous sync;
2. a **shared id** — the Clerk organization id in the customer's metadata;
3. the **domain** of the customer's email, when the connection matches by domain and the customer
   names no shared id. The domain is only a match key: a customer placed by its shared id sends
   none, so a billing email (an accountant's, a founder's own) never adds a domain to the account.

Anything else waits in the unmatched list, holding its op, and ingest replays it the moment someone
links it.

## Setting it up

1. **Restricted key** — Stripe Dashboard → Developers → **API keys** → _Create restricted key_,
   with **Read** on:

    | Resource        | Why                                                    |
    | --------------- | ------------------------------------------------------ |
    | Customers       | the accounts and their billing contacts                |
    | Subscriptions   | MRR, plan, status, trial, scheduled cancellation       |
    | Invoices        | amounts, due dates, failed payments, the hosted copy   |
    | Products        | the plan names (a price only carries its product's id) |
    | Prices          | the amounts and intervals embedded in a subscription   |
    | Payment methods | the card brand, last four and expiry on file           |
    | Events          | the scheduled pull's change feed (`GET /v1/events`)    |

    Everything else can stay **None**; Hazel only ever issues GETs. A full secret key works too.
    Connecting reads one record of each resource, with the same `expand[]` the pull uses, so a key
    missing a permission says which one at connect time instead of failing the first backfill.

2. **Account id** (`acct_…`, Stripe Dashboard → Settings → Business → Account details). The
   connection's `externalAccountId` is **required**: core tells a key of another account by it
   (dropping the old account's data and importing from scratch), and webhook deliveries are checked
   against it. A secret key reads it (`GET /v1/account`), and an id entered in the form must match.
   A restricted key **cannot** read its own account (Stripe answers 403: the account is outside what
   a restricted key's permissions cover), so with one the id must be entered. Hazel checks its shape
   and, where Stripe gives the real id away — the 403's message (`… on account 'acct_…'`), the first
   invoice's hosted URL (`invoice.stripe.com/i/acct_…/…`) — that it matches; a mismatch fails to
   connect, naming both. With neither to compare against the entered id is taken as given; a wrong
   one then only makes webhook deliveries stamped with the real account (Connect) be refused. The
   id is read when a key is validated (connecting, or entering a new key): changing it alone moves
   nothing.

3. **Webhook** — Stripe Dashboard → Developers → **Webhooks** → add an endpoint:

    ```
    POST https://<api host>/webhooks/customers/stripe/<organizationId>/<connectionId>
    ```

    The data-sources page shows the exact URL once the connection exists (the ids are in the path,
    the signature is the auth). Subscribe:

    `customer.created`, `customer.updated`, `customer.deleted`,
    `customer.subscription.created`, `customer.subscription.updated`,
    `customer.subscription.deleted`, `customer.subscription.paused`,
    `customer.subscription.resumed`, `invoice.finalized`, `invoice.paid`,
    `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.voided`,
    `invoice.marked_uncollectible`, `payment_method.attached`, `payment_method.updated`,
    `payment_method.automatically_updated`, `payment_method.detached`

    The webhook is optional: without one every change still arrives through the scheduled pull's
    event feed, up to 6 hours late.

4. Paste the endpoint's **signing secret** (`whsec_…`) into the connect form. Both secrets are
   stored encrypted in `customer_connection_secrets` and decrypted only to call Stripe or verify a
   delivery.

Every request pins `Stripe-Version: 2025-08-27.basil`, so a Dashboard upgrade cannot change the
wire shape under Hazel. A webhook endpoint delivers in **its own** pinned version, which is rarely
the same one, so the schemas read both places of everything that moved between versions (the
subscription period, the invoice's subscription, a discount's coupon).

### Matching Autumn-managed accounts

Maple's Stripe customers are created by **Autumn**, which writes the Autumn customer id into the
Stripe customer's `metadata` under `autumn_id` (Autumn's `createStripeCustomer`, next to
`autumn_internal_id`) — and that id is the Clerk organization id. So a customer with no value under
the configured metadata key (`clerk_org_id` by default) falls back to `autumn_id`, when that is
shaped like a Clerk organization id (`org_…`). An Autumn-managed account therefore matches with no
configuration. No other metadata is read: an `org_…` value another tool wrote under some other key
is not a shared id, and the configured key always wins over `autumn_id`.

## Mapping

| Stripe                                                        | Hazel                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| customer `id`                                                 | account external ref `(stripe, cus_…)`                      |
| customer `metadata[clerkOrgMetadataKey]`, else `autumn_id`    | `sameAs` → the Clerk account (`matchMethod: shared_id`)     |
| customer `email` domain, without a shared id                  | a domain match when the toggle is on                        |
| customer `name`                                               | `account.name` (Clerk's wins, `FIELD_PRECEDENCE`)           |
| customer `created`                                            | `account.firstSeenAt` if earlier                            |
| customer `email`                                              | a contact with `isBillingContact`, keyed on the customer id |
| customer deleted                                              | ref goes stale; account soft-deleted with no live ref left  |
| subscription `items[].price × quantity`, per interval         | `subscription.mrrMinor` (see below)                         |
| subscription coupons                                          | applied to `mrrMinor`; `listMrrMinor` keeps the list price  |
| price's product `name`                                        | `subscription.planName`                                     |
| subscription `status`                                         | `subscription.status`                                       |
| subscription `start_date`, `trial_end`, period end            | `startedAt`, `trialEndsAt`, `currentPeriodEnd`              |
| `cancel_at_period_end` or a `cancel_at`, `canceled_at`        | `cancelAtPeriodEnd`, `canceledAt`                           |
| `cancellation_details.reason` (else `feedback`)               | `subscription.cancellationReason`                           |
| `default_payment_method`, else the customer's invoice default | card brand, last four, expiry; none on file clears it       |
| invoice `status`, `number`, `amount_due`, `amount_paid`       | the invoice row                                             |
| invoice `due_date`, `next_payment_attempt`                    | `dueAt`, `nextRetryAt`                                      |
| invoice `status_transitions.finalized_at` / `paid_at`         | `issuedAt`, `paidAt`                                        |
| invoice `attempt_count`, `hosted_invoice_url`                 | `attemptCount`, `hostedUrl`                                 |
| invoice's subscription (`parent.subscription_details`)        | the invoice's subscription                                  |

Ingest raises the timeline entries itself — `subscription.started`, `subscription.plan_changed`,
`subscription.cancel_scheduled`, `subscription.canceled`, `invoice.paid`,
`invoice.payment_failed` — from the state changes these ops describe, so the adapter emits no
event ops of its own.

**Statuses.** `trialing`, `active`, `past_due`, `unpaid`, `paused` and `canceled` map across. An
`incomplete` subscription (a first payment that never went through) is **skipped** until it goes
`active`, so an abandoned checkout raises no `payment_failed` signal; `incomplete_expired`, where
one ends, is skipped too — it was never recorded, so recording it would be churn that never was.
A status Stripe adds later is skipped rather than guessed at, and the next pull picks it up once
the mapping knows it.

**Plan names** come from the price's product, looked up with one `GET /v1/products?ids[]=…` per
batch of subscriptions — on the full walk and on every event alike. A lookup that fails never
falls back: the pull page is retried, a delivery refused (and retried by Stripe) or acknowledged
unwritten, so the stored name stays. Only a product Stripe does not return at all falls back to
the price's `nickname` or `lookup_key`.

**Invoices.** Drafts are not recorded (nothing reads one, and Stripe deletes drafts without a trace a
sync could follow); an invoice is recorded once finalized. The decline reason is written only by an
`invoice.payment_failed` / `payment_action_required` event about an invoice still open, and is
otherwise left as stored, never cleared.

**Which billing source counts.** An account's MRR comes from **Autumn** once an Autumn connection
finished its first import, else from Stripe (the other provider's subscriptions are ignored for
MRR). Invoices always come from Stripe. While a Stripe
backfill is importing, or its history rebuild is pending, compute writes no MRR movements: the
rebuild after the backfill writes the year's history in one go (`tech-design.md` §4.2).

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
  Discounts are expanded wherever a subscription is read (`expand[]=discounts`), webhooks included,
  so their coupons always apply.
- The amount is rounded once, at the end, and never goes below zero.
- `mrrMinor` is what the subscription bills **or would bill**, whatever its status: compute decides
  which statuses count towards an account's MRR (`active`, `past_due`, `unpaid`), reads a trial's
  list price for ranking, and needs a canceled subscription's amount to recognise the churn
  (`tech-design.md` §4.2).
- The plan name, interval and quantity come from the item that carries most of the amount.

## Syncing

| Phase           | Request                                                            | Writes                              |
| --------------- | ------------------------------------------------------------------ | ----------------------------------- |
| `customers`     | `/v1/customers`                                                    | accounts and their billing contacts |
| `subscriptions` | `/v1/subscriptions?status=all` (expanded) + `/v1/products?ids[]=…` | subscriptions and MRR               |
| `invoices`      | `/v1/invoices`, the last 365 days                                  | invoices                            |
| `events`        | `/v1/events?types[]=…&created[gte]=since` + one read per object    | whatever changed                    |

Paging is Stripe's own `starting_after`, which is id-based, so a record deleted mid-walk cannot
shift a page past another one and no page has to re-read the one before it. The phase and the
cursor live in the run's cursor, so an evicted object resumes where it stopped; a cursor Hazel
cannot read (an earlier deploy's format) is logged and the pull starts over.

- **The backfill (`since: null`) walks `customers` → `subscriptions` → `invoices`**, so its last
  page sets `PullPage.sweep = ["account"]` and core removes the customers it did not see (deleted
  while no webhook reached Hazel). Invoices are bounded to the last 365 days: nothing older answers
  a signal or a rollup, and a decade of invoices cannot stall a connection.
- **A scheduled pull (every 6 hours, and "sync now") reads the event log.** None of Stripe's list
  endpoints filter by a change time, so listing what was _created_ since the last success would
  miss every renewal, cancellation and failed payment of an older subscription or invoice.
  `/v1/events` is Stripe's change feed: the pull lists the handled event types since the last
  success (minus core's overlap) and turns each into ops exactly as a webhook delivery is turned
  (`opsOfEvent`, below), reading the event's object for its current state. Each object is read once
  per page however many of its events the page holds, four at a time, so a pull costs about one
  request per changed object, and it never sweeps. It needs **Events: Read**. Stripe keeps events
  for 30 days, so a connection whose last success is older than 29 days runs the full walk instead.
  This is what keeps a connection with no webhook endpoint correct, up to 6 hours late.

**Every event re-reads its object.** A webhook payload is the object as it was when the event
happened; deliveries come in any order and are retried for up to three days, and a subscription
payload carries its discounts and card as bare ids. So the event only says which object changed:

| Event                                                                 | Reads                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------- |
| `customer.*`                                                          | `GET /v1/customers/{id}` (a deleted one → its deletion) |
| `customer.subscription.*`                                             | `GET /v1/subscriptions/{id}` (expanded)                 |
| `invoice.*`                                                           | `GET /v1/invoices/{id}`                                 |
| `payment_method.*` (a detached one's customer: `previous_attributes`) | `GET /v1/subscriptions?customer=…` (expanded)           |

Ops are observed at the time of the read, so events applied in any order, or twice, land on the
same state, and a webhook writes exactly what a pull would. The read also proves the object belongs
to the key's account: another account's id answers 404, and a 404 is skipped (acknowledged, nothing
written). A read that fails transiently (unreachable, timed out, 429, 5xx) refuses the delivery —
nothing written, Stripe retries it — or fails the pull page, which core retries; any other failure
(the key lost a permission) acknowledges the delivery unwritten, and the next pull reports it on the
connection.

Deliveries are verified with Stripe's scheme (`stripe/signature.ts`): HMAC-SHA256, hex, over
`${timestamp}.${rawBody}`, keyed with the endpoint's signing secret **as Stripe shows it** — the
`whsec_` prefix included, unlike Svix, where the secret is base64 after its prefix. Several `v1`
signatures appear while an endpoint's secret is being rolled and any one matching is enough; every
other scheme is ignored (Stripe sends a deliberately wrong `v0` on test-mode events). A timestamp
outside ±5 minutes is refused, so a captured delivery cannot be replayed, and the comparison is
constant-time. An event stamped with another account than the key opens (a Connect platform's endpoint
relays its connected accounts' events with `account` set), or from the other mode (the key's prefix
says which), is refused too; an unstamped one is checked by its read, above — so a test-mode endpoint's secret next to a live key cannot write test
data into a production connection. A pull reads only the key's own account: Hazel never sends
`Stripe-Account`.

Refused deliveries are answered 400. Stripe retries a non-2xx with backoff for up to three days, so
the adapter refuses what a retry cannot fix (signature, replay window, a payload that does not
decode, the wrong account or mode) and what a retry will (a transient read failure), and
acknowledges every event type it does not handle.

Failures: 401 → `auth` (the run fails, the connection goes to `error`, pulls stop until the key
changes); 403 → `auth` too, naming the route the restricted key may not read. Both carry Stripe's
explanation, truncated and with the masked key Stripe quotes in it removed. 429 → waited out in
place while the delay is ≤ 5 s, otherwise `rate_limited` with that delay; 5xx → `provider`;
unreachable, or no answer within 30 s → `network`. Those are retryable: the run stays `running` at
its cursor and the next attempt resumes from the failed page; after 8 failed attempts in a row at
one cursor (rate limits aside) core fails the run, sweeping nothing, and the next pull starts over.
Any other 4xx (a `starting_after` id Stripe no longer knows, say) is a `provider` error that is
**not** retried, since the same request would be refused again; so is a body that does not decode
(Stripe changed its API), whose failure is logged by path and issue kind only, never with the
payload. Messages reach every member of the organization, so beyond a refused key's they name only
the route and status, never Stripe's text.

The reads a delivery makes are never retried in place and give up after 5 s: a delivery must answer
before Stripe times out. A delivery whose
connection switched Stripe account (or was disconnected) while it ran is dropped by core and
acknowledged, so Stripe does not retry it into the new account.

## Known gaps

- **A webhook costs one or two requests.** Every delivery reads its object, and one that writes
  subscriptions reads their plans' names too (`/v1/products?ids[]=…`), cached nowhere.
- **`payment_method.*` names no subscription**, so it lists the customer's
  (`GET /v1/subscriptions?customer=…`) to write the card against them. A customer with no
  subscription writes nothing.
- **The decline reason** Stripe shows lives on the invoice's payment intent, which Hazel does not
  read (it would need another permission). An `invoice.payment_failed` event about an open invoice
  therefore records "Stripe could not collect this payment" — which is also what lets ingest raise
  `invoice.payment_failed` on the _first_ attempt, where `attempt_count` is still 1.
- **`invoice.upcoming` is not handled.** Stripe's preview has no invoice id, and nothing in Hazel
  reads an `upcoming` invoice yet (the status exists in the model for a provider that does).
- **Metered and tiered prices contribute no MRR** (see above), so an account billed purely by usage
  through Stripe shows an MRR of 0. Usage belongs to the Autumn and Maple sources.
- **A customer's domain can still reach its account** when it was matched by domain (the account
  already has it) or linked by hand: ingest merges an op's match domains into the account it lands
  on. One placed by its shared id never sends a domain.
- **A restricted key's account id is taken on trust** when Stripe's answers carry none to compare
  (no invoice yet, a 403 message that names no account).
- **Credit notes and refunds** are not read: an invoice's amounts are what Stripe reports on it.
