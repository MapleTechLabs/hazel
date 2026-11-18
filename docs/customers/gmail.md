# Gmail data source

Gmail brings the **conversations** between an organization's people and its customers onto each
customer's timeline: every email exchanged with a customer becomes an `email.received` or
`email.sent` event, and the whole email (participants, subject, plain-text body) opens from it.

It is a **per-person** source. Every Customers member may connect their own mailbox (several, if
they hold several), so an organization has one Gmail connection per mailbox, unlike Clerk, Stripe,
Autumn and Maple (one connection each). Gmail creates no account and no contact: it only places
mail on the customers the other sources already hold, and drops the rest.

Implementation: `apps/backend/src/worker/objects/customers/gmail/` — `adapter.ts` (credentials,
pull), `oauth.ts` (Google's consent URL and token endpoint), `http.ts` (the Gmail reads), `pull.ts`
(the walk), `map.ts` (a message → an `email` op), `connect.ts` (the object call the callback makes),
`wire.ts` (Google's shapes). The OAuth routes: `apps/backend/src/routes/customers-gmail.http.ts`.
Attribution: `applyEmail` in `ingest-live.ts`. Contracts: `docs/customers/tech-design.md` §3 and §5.

## Setting it up (once per Hazel server)

1. **A Google Cloud project** with the **Gmail API** enabled (APIs & Services → Library → Gmail
   API).
2. **The OAuth consent screen** (Google Auth Platform → Branding / Audience / Data access). Add the
   scope `https://www.googleapis.com/auth/gmail.readonly`. It is a **restricted** scope, which
   decides what the audience can be:
    - **Internal** (only when the project belongs to a Google Workspace organization, and every
      mailbox is in that Workspace): no verification, no user cap, and refresh tokens do not expire
      on their own. The right choice for using Hazel on your own team's mail.
    - **External, in Testing**: at most 100 test users (each added by address), and Google expires
      every refresh token after **7 days**, so each mailbox has to be reconnected weekly (the
      connection turns to `error` with "reconnect Gmail" when it happens). Fine for trying it out.
    - **External, in production**: Google's app verification plus, for a restricted scope, a yearly
      third-party security assessment (CASA). Needed before connecting mailboxes outside your own
      Workspace at scale.
3. **An OAuth client** (Credentials → Create credentials → OAuth client ID → Web application) with
   the redirect URI `<API_BASE_URL>/customers/gmail/callback`, e.g.
   `https://api.hazel.sh/customers/gmail/callback`, and for local dev
   `http://localhost:3003/customers/gmail/callback` (Google accepts localhost redirects).
4. **The env**: `GOOGLE_GMAIL_CLIENT_ID` (plain) and `GOOGLE_GMAIL_CLIENT_SECRET` (secret) on the api
   Worker (`apps/backend/src/worker/env.ts`; locally in `.env.local`). Without them the connect
   button's route answers `?gmail=error&reason=not_configured` and nothing else changes.

## Connecting a mailbox

The web app sends the browser (a navigation, not a fetch) to
`GET <api>/customers/gmail/authorize?organizationId=<org>`. The route checks the person is signed in
and a member of the organization, then redirects to Google's consent screen (`gmail.readonly`,
offline access, consent always asked so a refresh token always comes back). The `state` names the
organization and the person, expires after 15 minutes and is signed with the OAuth client's secret;
its nonce is also set as an httpOnly cookie on the api host, so the flow only completes in the
browser that started it.

Google redirects to `GET <api>/customers/gmail/callback`, which checks the state and the cookie,
exchanges the code, checks the mail scope was granted, reads the mailbox's address
(`users.getProfile`) and calls the organization's `CustomersObject` (`customers.gmailConnect`). The
object refuses anyone who is not a member of the organization, stores the **refresh token**
encrypted as the connection's key, and starts the backfill. The browser lands on
`<web>/<org slug>/customers/settings/sources/gmail?gmail=connected`, or `?gmail=error&reason=<code>`
(`not_configured`, `denied`, `scope_missing`, `invalid_state`, `token_exchange_failed`,
`profile_failed`, `forbidden`, `failed`).

Connecting a mailbox that is already connected (after Google revoked the grant, after a disconnect,
or by another member who also holds it) updates the same connection: new token, error cleared,
`connectedBy` the person who reconnected, pulls resume. Nothing is wiped.

**Who manages a connection.** Sync now, settings (`lookbackDays`) and disconnect: the member who
connected the mailbox, or an admin or owner. `customers.connection.connect` (the API-key path)
refuses Gmail, and `customers.connection.update` refuses an API key for it.

**Disconnecting** drops the refresh token and stops pulls. The emails and events already imported
stay (as with every source). The token is not revoked at Google; the person can remove Hazel's
access under their Google account's security settings.

## What is imported

Each message of the mailbox (`users.messages.list` with `q = after:<epoch> -in:spam -in:trash
-in:chats`, then `users.messages.get` with `format=full`):

- **Participants**: From, To and Cc, parsed into addresses (lowercased) and names (RFC 2047 encoded
  words decoded, as in the subject).
- **Direction**: `outbound` when one of the organization's own addresses sent it (the mailbox, any
  other connected mailbox, or Gmail's `SENT` label), else `inbound`.
- **Subject** (≤ 1,000 characters) and Gmail's **snippet**.
- **Body**: the first `text/plain` part of the MIME tree, else the first `text/html` part stripped
  of its markup, decoded in the part's charset, capped at **100,000 characters**. A body too large
  for Gmail to inline is read with `users.messages.attachments.get`; attachments are never fetched.
- **When**: Gmail's `internalDate`.
- Drafts are skipped. Spam, trash and Google Chat are never listed.

The email is stored once per **`Message-ID`** in `customer_emails` (not synced: bodies are large),
so a thread two members both hold lands once. Each matched account gets one event
(`customer_events`, provider `gmail`, type `email.received` / `email.sent`, title = subject, the
matched contact when there is one), keyed `<Message-ID>:<accountId>`. The event's `data` is
`{ emailId, direction, snippet, from, to, cc }` (at most 10 recipients of each); the whole email is
read with `customers.email.get`, which also answers the link that opens the thread in Gmail
(`https://mail.google.com/mail/u/<mailbox>/#all/<threadId>`; only someone signed into that mailbox
can open it).

An imported email does not move `lastActiveAt` or any activity metric: activity is product usage.

## Matching

Ingest attributes each email, not the adapter:

1. **External participants**: every address on it except the connected mailboxes' and those of the
   organization's own domains (each mailbox's domain, unless it is a free-mail domain such as
   gmail.com).
2. For each external address: a live **contact with that exact address** (case-insensitive) places
   the email on the contact's account, with the contact on the event. Several accounts holding the
   same person each get the email.
3. Otherwise its **domain**, when exactly **one** live account lists it in `domains`. A domain two
   accounts share, and every free-mail domain, places nothing.
4. **No account matched: the email is dropped.** Nothing is parked in the unmatched list, nothing is
   stored.

Matching happens when the email is read. A contact or domain added later does not reach back to
mail already read, except what the next scheduled pull's overlap re-reads.

## Syncing

Polling, every **10 minutes** (no Pub/Sub push, no webhooks). A backfill reads `lookbackDays` back
(default 90, 1–365); a scheduled pull reads from core's last success minus its 10-minute overlap
(ingest is idempotent). A page is one list of **25** ids and their 25 reads (5 at a time), plus one
token refresh per connection per alarm turn (the access token is kept in memory, never stored). Core
pulls at most 20 pages per connection per alarm, so a turn stays around 500 Gmail requests per
mailbox, far under Gmail's per-user quota. The cursor (`{ after, pageToken, done }`) is persisted on
the run, so an evicted object resumes the same page.

### Failures

- `invalid_grant` at the token endpoint (access revoked, password changed, or a Testing app's 7-day
  expiry) → `auth`: the connection goes to `error` with "reconnect Gmail" and pulls stop until the
  mailbox is connected again. A refused OAuth client is `auth` too.
- 401 → `auth`; 403 → `auth`, except Gmail's quota refusals (`rateLimitExceeded`,
  `userRateLimitExceeded`), which are `rate_limited` and retried after a minute, like a 429.
- 5xx, unreachable, or no answer within 30 s → retried after core's backoff.
- A message deleted between the list and its read (404) is skipped.
- The server lost its OAuth client env → a retryable failure (not the connection's fault).

## Privacy

- **Every Customers member of the organization can read every imported email**, from any member's
  mailbox, through the customer's timeline. Connecting a mailbox shares its mail with customers
  with the whole Customers area of that organization; the connect screen should say so.
- Only mail with a matched customer on it is stored; the rest is read and dropped.
- The refresh token is encrypted at rest (`IntegrationEncryption`), never synced, never returned.

## Known gaps

- **No push.** New mail shows up within about 10 minutes, not instantly.
- **Matching is not retroactive** beyond the pull overlap: an account created after an email was
  read does not get it. Reconnecting does not re-read history either; only a new connection's
  backfill does.
- **One direction per email.** It is decided when the email is first stored, from what the
  connected mailboxes knew then.
- **No revoke on disconnect** (see above).
- **Thread links open only for the mailbox's owner**; other members read the stored copy.
