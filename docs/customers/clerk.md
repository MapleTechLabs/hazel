# Clerk data source

Hazel's identity source for Customers: a Clerk **organization** is a customer account, its
**members** are that account's contacts, and **sign-ins** are the activity every usage signal and
health score reads. Adapter: `apps/backend/src/worker/objects/customers/clerk/`, registered in
`customers/providers.ts`. It produces `IngestOp`s only — `CustomerIngest` does every write
(`tech-design.md` §3).

The Clerk organization id is the account's primary external ref, which is what lets the other
sources land on the same customer: Stripe matches `metadata.clerk_org_id`, the Autumn customer id
_is_ the Clerk org id, and Maple's `GroupId` is too (`UpsertAccount.sameAs`).

## Setting it up

1. **Secret key** — Clerk Dashboard → Configure → **API keys** → Secret keys. `sk_live_…` reads the
   production instance, `sk_test_…` the development one. Clerk secret keys are not scoped, so there
   is nothing to tick; Hazel only ever issues GETs.
2. **Webhook** — Clerk Dashboard → Configure → **Webhooks** → add an endpoint:

    ```
    POST https://<api host>/webhooks/customers/clerk/<organizationId>/<connectionId>
    ```

    The data-sources page shows the exact URL once the connection exists (the ids are in the path,
    the Svix signature is the auth). Subscribe:

    `organization.created`, `organization.updated`, `organization.deleted`,
    `organizationMembership.created`, `organizationMembership.updated`,
    `organizationMembership.deleted`, `user.created`, `user.updated`, `user.deleted`,
    `session.created`

3. Paste the endpoint's **signing secret** (`whsec_…`) into the connect form. Both secrets are
   stored encrypted in `customer_connection_secrets` and decrypted only to call Clerk or verify a
   delivery.

Connecting validates the key with one `GET /organizations?limit=1` and then `GET /instance`, whose
id is stored as the connection's `externalAccountId` (and re-read when the key changes: a key of
another instance makes core drop the old instance's data) and names the instance in the UI. The id
is required: a Clerk secret key carries no instance id of its own, so when `/instance` is refused
there is nothing stable to fall back on, and connecting fails with a message saying so. A secret
key opens exactly one instance, so what a sweep lists is always the connection's. Without a signing
secret the connection still works, but only through the scheduled sweep (core refuses its
deliveries with a 400).

Deliveries are verified with Svix's scheme (`customers/svix.ts`): HMAC-SHA256 over the raw body,
and a `svix-timestamp` outside ±5 minutes is refused, so a captured delivery cannot be replayed. An
event whose `instance_id` is not the instance the secret key opens, or that carries none, is refused
too, so a development instance's signing secret next to a production key cannot write test data.

Refused deliveries are answered 400. Svix retries every non-2xx on its schedule until it gives up,
so the adapter refuses only what a retry cannot fix (signature, replay window, a payload that does
not decode, the wrong instance) and acknowledges every event type it does not handle.

## Mapping

| Clerk                                               | Hazel                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| organization `id`                                   | account external ref `(clerk, org_…)` — the shared id                      |
| organization `name`                                 | `account.name`                                                             |
| verified organization domains                       | `account.domains` (merged, never removed)                                  |
| organization `image_url` (when `has_image`)         | `account.logoUrl`                                                          |
| organization `members_count`                        | `account.seatsUsed`                                                        |
| organization `max_allowed_memberships`              | `account.seatsLimit` (`0` = unlimited → null)                              |
| organization `slug`                                 | `account.attributes.slug`                                                  |
| organization `created_at`                           | `account.firstSeenAt`                                                      |
| organization deleted                                | ref goes stale; account soft-deleted with no live ref left                 |
| membership `public_user_data.user_id`               | contact external ref, one contact **per account**                          |
| membership `role_name` (else `role` without `org:`) | `contact.role`                                                             |
| membership `created_at`                             | `contact.joinedAt`                                                         |
| membership deleted                                  | contact soft-deleted → `contact.removed` event                             |
| user primary email                                  | `contact.email`                                                            |
| user `first_name` + `last_name` (else `username`)   | `contact.name`                                                             |
| user `image_url` (when `has_image`)                 | `contact.avatarUrl`                                                        |
| user `last_sign_in_at`                              | `contact.lastSignInAt`; `signedIn` on the activity day when it is that day |
| user `last_active_at`                               | `contact.lastSeenAt` + that day's activity in every account of the user    |
| `session.created`                                   | the contact's `lastSignInAt` / `lastSeenAt` + one account's `signedIn` day |
| `user.updated`                                      | the user's contact and activity day in every account Clerk lists them in   |
| membership webhooks' `organization`                 | the account's ref only: never its name, logo or seats, never creates it    |
| `organization.created`                              | `account.created` timeline event                                           |

Ingest raises `contact.joined`, `contact.removed` and `contact.first_active` itself, so the adapter
does not duplicate them.

**Ordering.** Account and contact ops carry `observedAt`: a webhook's is the record's `updated_at`
(else the event's `timestamp`), a sweep's the time it asked Clerk; `organization.deleted` and
`organizationMembership.deleted` are dated by the event's `timestamp`. Ingest ignores an op observed
at or before the deletion, so a late retry of `organization.updated` cannot revive a deleted
organization, and `organizationMembership.deleted` never writes the organization at all.

**No domain matching.** Clerk account ops never set `matchByDomain`: two organizations sharing a
domain are two customers. Verified domains only describe the account they belong to.

**A user in several organizations** becomes one contact per account, all sharing the Clerk user id —
which is exactly what `customer_external_refs` allows for contacts (unique on
`(provider, externalId, accountId)`). Their role, `joinedAt` and activity are recorded per account,
so Ada can be an admin of one customer and a billing manager of another.

**Activity.** Clerk keeps only the _latest_ `last_sign_in_at` / `last_active_at` per user, never a
per-day history, and never which organization it was in. A user record (a sweep, `user.updated`)
moves the contacts' `lastSignInAt` / `lastSeenAt` and credits the `last_active_at` UTC day, in
**every** account the user is a member of, with `signedIn` when it is also the `last_sign_in_at`
day. A user in several organizations therefore over-credits recency to the ones they were not
active in; without it a Clerk-only account would have no activity day at all, read as never
active, score near critical on health and raise `onboarding_stalled` / `inactive` /
`champion_inactive` for customers using the product. The activity op follows its contact op, since
ingest parks activity for a contact it does not know. A `last_active_at` day already past core's
400-day activity retention when the user was observed is not written (the next prune would delete
it). The `session.created` webhook adds the
day's sign-in, credited to one account:

- a session scoped to an organization (`last_active_organization_id`) credits that one, without a
  request to Clerk: the contact op names only the Clerk user id and the account, so it lands on the
  contact the membership created and leaves its email and name alone;
- an unscoped session asks Clerk for the user's memberships, moves `lastSignInAt` in each, and
  credits the day only when there is exactly one;
- an impersonation session (`actor` set) writes nothing.

Clerk never says how many sessions a day held, so Clerk writes `sessionCount: 1` as a floor and owns
`signedIn`; event counts stay Maple's.

**Partial user data.** A membership webhook names its user only through `public_user_data`; what that
does not say (an `identifier` that is no email address, no name, no `has_image`) is left as stored
rather than cleared. Its copy of the organization may be older than what `organization.updated`
already wrote, so its account op carries the organization's ref only (creating the account, named by
its id, if the organization's own events have not arrived yet).

## Syncing

A sweep (the connect-time backfill, a "sync now", and every six hours) walks the instance in three
phases, held in the run's cursor so an evicted object resumes where it stopped:

| Phase           | Request                                                      | Writes                                   | Requests per page |
| --------------- | ------------------------------------------------------------ | ---------------------------------------- | ----------------- |
| `organizations` | `/organizations?include_members_count=true`                  | accounts, including ones with no members | 1                 |
| `members`       | `/organization_memberships` + one batched `/users?user_id=…` | contacts, roles, last active days        | 2                 |
| `domains`       | `/organization_domains?verified=true`                        | the accounts' domains                    | 1                 |

`/organization_memberships` carries each membership's whole organization and public user data, so
no per-organization request is needed; the second call fetches the hundred users behind the page
(Clerk's `user_id` filter takes up to 100 ids) for their emails and activity timestamps.

None of Clerk's list endpoints filter by a change time, so a scheduled pull cannot be narrowed: it
re-walks the instance and ingest writes only what changed. That is why the period is six hours —
webhooks carry the live signal, the sweep only reconciles missed deliveries.

Since every sweep lists every organization and membership, its last page sets
`PullPage.sweep = ["account", "contact"]`: core then removes the accounts and contacts the sweep
did not see (deleted while no webhook reached Hazel). Every listing asks for
`order_by=+created_at` (Clerk's default is newest first), so a record created mid-sweep lands after
the rows not read yet. A deletion still shifts the rest back, which offset paging would skip, so
each page re-reads the previous page's last 10 rows, and the cursor keeps that page's last id. When
it is not among the re-read rows, more were deleted than the overlap covers (or rows created in the
same millisecond came back in another order: Clerk documents no tie-breaker), so the sweep carries
on as `partial` and its last page sets no `sweep`: nothing is removed on a listing that may have
missed a record. A page that ends in 10 or more rows created in the same millisecond is `partial`
too: the next request may list one of them before the rows it re-reads. A record removed wrongly all the same comes back on the next sweep, whose ops are
observed after the removal.

Failures: 401/403 → `auth` (the run fails, the connection goes to `error`, pulls stop until the
key changes; the message carries Clerk's explanation, truncated); 429 → waited out in place while
Clerk's `Retry-After` is ≤ 5 s, otherwise `rate_limited` with that delay; 5xx → `provider`;
unreachable, or no answer within 30 s (5 s for the one request a webhook makes, which must answer
Svix) → `network`. Those are retryable: the run stays `running` at its cursor and the next
attempt resumes the sweep from the failed page, after `Retry-After` or core's backoff. Messages
reach every member, so other refusals name only the route and status, never Clerk's text. A body that does not decode (Clerk changed its API) is a
`provider` error that is not retried: the run fails with a message saying so, and the decode
failure is logged by path and issue kind only, never with the payload.

## Known gaps

- **`user.deleted`** carries only `{ id, deleted }`, and the user is gone, so there is no way left
  to learn which accounts they belonged to, and Clerk's docs do not promise an
  `organizationMembership.deleted` per membership. When Clerk sends them they remove the contacts;
  otherwise the next sweep does (it lists no membership of the user). The adapter cannot remove
  them itself: a removal op names its account, and ingest has no "every contact with this ref" op.
- **`user.*` and unscoped `session.created`** payloads carry no memberships, so each costs one
  `GET /users/{id}/organization_memberships`, never retried in place (a delivery must answer before
  Svix times out). If that request fails the delivery is still acknowledged (2xx) and the next sweep
  fills the rest: refusing it would have Svix redeliver it into a Clerk that is already refusing.
  The request asks for 500 memberships (Clerk's largest page) and does not page further: a user in
  more organizations is updated in the first 500 only, until the next sweep.
- **A session for an organization Hazel does not hold yet** (its `organization.created` not
  delivered, or `createAccounts` off) parks its contact and its sign-in day. The next sweep credits
  the user's `last_active_at` day once the account exists, so that day is lost only when the user
  was active again on a later day before the sweep ran.
- **A membership webhook for an organization Hazel does not hold yet** parks the organization (its
  ref only) and the contact: the membership's account op never creates an account, so a customer
  is created only from the organization's own record, its name checked against ignore rules. The
  organization's `organization.created` / `.updated` or the next sweep creates it, and the parked
  contact lands then.
- **A scoped session before its membership webhook** creates the contact from the Clerk user id
  alone (no email yet); the membership webhook then fills it in. Should a contact with that email
  already exist in the account from another source and with no Clerk ref, the two are not merged.
- **Removed domains stay.** Ingest only ever adds an account's domains (`UpsertAccount.domains`
  merges), so a domain Clerk unverifies or deletes stays on the account until removed by hand.
- **A Clerk listing that keeps failing** at one offset (a 5xx at a large offset, say) keeps the run
  retrying from that page with core's backoff (≤ 6 hours); the adapter sees no failure count, so
  giving up on the run is core's to decide.
- **Role changes** have no "before" in Clerk's payload, so `organizationMembership.updated` writes
  the new role without a timeline entry saying what it was.
- Unverified organization domains are ignored, so account matching never leans on a domain a
  customer has not proved.
