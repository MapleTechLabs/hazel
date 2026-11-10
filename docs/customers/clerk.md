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

Connecting validates the key with one `GET /organizations?limit=1` and then, best-effort,
`GET /instance` so the UI can name the instance it opened. Without a signing secret the connection
still works, but only through the scheduled sweep (core refuses its deliveries with a 400).

Deliveries are verified with Svix's scheme (`customers/svix.ts`): HMAC-SHA256 over the raw body,
and a `svix-timestamp` outside ±5 minutes is refused, so a captured delivery cannot be replayed.

## Mapping

| Clerk                                               | Hazel                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| organization `id`                                   | account external ref `(clerk, org_…)` — the shared id               |
| organization `name`                                 | `account.name`                                                      |
| verified organization domains                       | `account.domains` (merged, never removed)                           |
| organization `image_url` (when `has_image`)         | `account.logoUrl`                                                   |
| organization `members_count`                        | `account.seatsUsed`                                                 |
| organization `max_allowed_memberships`              | `account.seatsLimit` (`0` = unlimited → null)                       |
| organization `slug`                                 | `account.attributes.slug`                                           |
| organization `created_at`                           | `account.firstSeenAt`                                               |
| organization deleted                                | ref goes stale; account soft-deleted with no live ref left          |
| membership `public_user_data.user_id`               | contact external ref, one contact **per account**                   |
| membership `role_name` (else `role` without `org:`) | `contact.role`                                                      |
| membership `created_at`                             | `contact.joinedAt`                                                  |
| membership deleted                                  | contact soft-deleted → `contact.removed` event                      |
| user primary email                                  | `contact.email`                                                     |
| user `first_name` + `last_name` (else `username`)   | `contact.name`                                                      |
| user `image_url` (when `has_image`)                 | `contact.avatarUrl`                                                 |
| user `last_sign_in_at`                              | `contact.lastSignInAt`, and that day's `signedIn`                   |
| user `last_active_at`                               | `contact.lastSeenAt`, and that day's activity                       |
| `session.created`                                   | that day's `signedIn` + the contact's `lastSignInAt` / `lastSeenAt` |
| `organization.created`                              | `account.created` timeline event                                    |

Ingest raises `contact.joined`, `contact.removed` and `contact.first_active` itself, so the adapter
does not duplicate them.

**A user in several organizations** becomes one contact per account, all sharing the Clerk user id —
which is exactly what `customer_external_refs` allows for contacts (unique on
`(provider, externalId, accountId)`). Their role, `joinedAt` and activity are recorded per account,
so Ada can be an admin of one customer and a billing manager of another.

**Activity.** Clerk keeps only the _latest_ `last_sign_in_at` / `last_active_at` per user, never a
per-day history, so a sweep can mark at most those one or two days; the continuous per-day signal is
the `session.created` webhook. Clerk never says how many sessions a day held, so Clerk writes
`sessionCount: 1` as a floor and owns `signedIn`; event counts stay Maple's.

## Syncing

A sweep (the connect-time backfill, a "sync now", and every six hours) walks the instance in three
phases, held in the run's cursor so an evicted object resumes where it stopped:

| Phase           | Request                                                      | Writes                                   | Requests per page |
| --------------- | ------------------------------------------------------------ | ---------------------------------------- | ----------------- |
| `organizations` | `/organizations?include_members_count=true`                  | accounts, including ones with no members | 1                 |
| `members`       | `/organization_memberships` + one batched `/users?user_id=…` | contacts, roles, sign-in days            | 2                 |
| `domains`       | `/organization_domains?verified=true`                        | the accounts' domains                    | 1                 |

`/organization_memberships` carries each membership's whole organization and public user data, so
no per-organization request is needed; the second call fetches the hundred users behind the page
(Clerk's `user_id` filter takes up to 100 ids) for their emails and activity timestamps.

None of Clerk's list endpoints filter by a change time, so a scheduled pull cannot be narrowed: it
re-walks the instance and ingest writes only what changed. That is why the period is six hours —
webhooks carry the live signal, the sweep only reconciles missed deliveries.

Failures: 401/403 → `auth` (the run fails, the connection goes to `error`, pulls stop until the
key changes); 429 → waited out in place while Clerk's `Retry-After` is ≤ 5 s, otherwise
`rate_limited` with that delay; 5xx and unexpected bodies → `provider`; unreachable → `network`.
Every failure but `auth` is retryable: the run stays `running` at its cursor and the next attempt
resumes the sweep from the failed page, after `Retry-After` or core's backoff.

## Known gaps

- **`user.deleted`** carries only `{ id, deleted }`, and the user is gone, so there is no way left
  to learn which accounts they belonged to. Clerk emits `organizationMembership.deleted` for each of
  their memberships and that is what removes the contacts; the `user.deleted` delivery is verified
  and acknowledged.
- **`session.created` with no active organization** (the user has not picked one yet) costs one
  extra `GET /users/{id}/organization_memberships` and credits the day to every account they belong
  to. If that request fails the delivery still succeeds with no activity, rather than being retried
  forever.
- **Role changes** have no "before" in Clerk's payload, so `organizationMembership.updated` writes
  the new role without a timeline entry saying what it was.
- Unverified organization domains are ignored, so account matching never leans on a domain a
  customer has not proved.
