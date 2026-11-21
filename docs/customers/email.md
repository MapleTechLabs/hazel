# Customers: email support inboxes

Pylon's email channel on Hazel: a team forwards its support address (`support@acme.com`) to a
Hazel inbound address, every email conversation becomes a message and thread in a Hazel channel,
the team answers in the thread, and the answer goes back to the customer as an email, in the same
email thread. A conversation from a known customer is a support issue (`issues.md`) with SLAs
(`sla.md`), like one from a linked Slack channel.

## How Pylon does it, and what we keep

| Pylon                                                                                        | Hazel                                                                                                      |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Forward the support address to a unique Pylon inbound address (or connect Gmail / Outlook).  | Forwarding only: `<mailbox>@<INBOUND_EMAIL_DOMAIN>`. Mailbox OAuth is later.                               |
| Each new email thread is an issue; the requester is matched to an account by email / domain. | Each new email thread is a top-level message; matched to an account by contact email, then domain.         |
| Replies from the issue view go out as email (`From: Acme Support`, the customer's thread).   | Replies in the message's Hazel thread go out as email; top-level messages in the channel stay internal.    |
| Sent from the customer's own domain once verified, else Pylon's.                             | Sent from `<mailbox>@<SUPPORT_EMAIL_DOMAIN>` as "Alice from Acme Support", `Reply-To` the support address. |
| Quoted history is stripped from replies; CCs are kept on the thread.                         | Same: the quoted tail is cut; everyone the customer side wrote to or CC'd gets the reply.                  |
| Internal notes do not go out.                                                                | Top-level messages and anything outside the email's thread do not go out. Edits and reactions do not.      |

## Model: email is a chat-sync provider

Email is the third chat-sync provider (`provider: "email"`), next to Slack and Discord, so it
reuses the whole pipeline: the directory index, shadow authors, the org's ingest, message links,
outbound deliveries with retries, author-side classification and the support-issue hook.

| Chat sync                     | Email                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Connection (workspace)        | A mailbox. `externalWorkspaceId` = its id (random, `[a-z0-9]`, 16), `externalWorkspaceName` = its name.     |
| Channel link                  | The mailbox's Hazel channel: `externalChannelId` = the mailbox id. One link per mailbox.                    |
| Link `settings.email`         | `{ displayName, replyTo }`: the sender name and `Reply-To` (the support address; else the inbound address). |
| Connection `metadata`         | `{ inboundAddress }`, shown to admins to set up forwarding.                                                 |
| Message (`externalMessageId`) | The email's `Message-ID` (without `<>`; a hash of the raw message when it has none).                        |
| Thread                        | An email conversation's replies: `externalChannelId` `<mailbox>/<root Message-ID>`, named by the subject.   |
| Author (shadow user)          | One per sender address: `externalUserId` = the lower-cased address, external workspace = its domain.        |

## Inbound

The api Worker subscribes to Cloudflare Email Routing (`Cloudflare.email().subscribe`,
`services/email/inbound.ts`). For each message to `<mailbox>[+tag]@<INBOUND_EMAIL_DOMAIN>`:

1. **Mailbox.** The local part (before `+`) names the mailbox; one no org indexes is rejected
   (`setReject`, a bounce). Larger than 10 MB: rejected.
2. **Dropped silently:** automatic mail (`Auto-Submitted` other than `no`, bounces from
   `mailer-daemon` / `postmaster`, `X-Autoreply`, `X-Autorespond`) and anything from Hazel's own
   sending domain (a loop). Gmail's forwarding confirmation is kept, so the admin sees its link in
   the channel.
3. **Thread.** `References` and `In-Reply-To` are looked up in the directory's
   `email_thread_messages` (every message Hazel received or sent on the mailbox, with its root).
   A hit is a reply in that conversation; anything else starts a new one (root = itself).
4. **State.** `email_threads` (mailbox, root) keeps the subject, the customer-side participants
   (From, To and CC, minus the mailbox's own addresses), and the `References` chain; the message is
   recorded in `email_thread_messages`.
5. **Route.** A `ChatSyncInbound` `MessageCreate` (dedupe key `email:<mailbox>:<Message-ID>`):
   the text body (else the HTML's text) with the quoted tail removed, a new conversation prefixed
   with its subject in bold, a reply with `inExternalThreadId` = the root, so the org makes or finds
   the Hazel thread hung off the root message. Attachments are listed by name (not imported yet).

A failure after the mailbox is known propagates: Cloudflare answers a temporary SMTP error and the
sender retries, so nothing is accepted and lost. The dedupe key makes a retry land once.

## Outbound (`services/chat-sync/providers/email/client.ts`)

Email has no channel to post in: `ChatSyncProviderDefinition.threadsOnly` makes a team message at
the top level of the mailbox's channel stay in Hazel (`ignored("threads_only")`). A team reply in a
conversation's thread:

- **To**: the thread's participants (the mailbox's own addresses removed). **Subject**:
  `Re: <subject>`. **Headers**: `In-Reply-To` the latest message, `References` the chain (at most 20,
  root first). **From**: `<mailbox>@<SUPPORT_EMAIL_DOMAIN>` named "`<author>` from `<displayName>`";
  **Reply-To**: `settings.email.replyTo`.
- **Body**: the message as text (mentions become names) and as simple HTML; files as links.
- The Message-ID Cloudflare answers is the external message id, recorded in
  `email_thread_messages` and appended to the chain, so the customer's answer comes back to the thread.
- A Hazel thread started on the root message (`createThread`) needs no call: its id is the root.
- Edits, deletes and reactions cannot reach a sent email: no-ops.
- No participants (a conversation whose sender was dropped): fails without retry (a `failed` receipt).

## Issues: matching the sender to a customer

The mailbox's channel is not linked to one customer: it receives every customer's mail. The org
relays each message in a mailbox channel (and its threads) as `customers.inboxMessage`, when the
org has Customers turned on, with the author's address (a shadow's is its external id). The
`CustomersObject`:

- **A top-level message** is matched to an account: a live contact with that exact address, else a
  live account whose `domains` include the address's domain (free-mail domains never match);
  several: the most recently active. No match: no issue (the conversation is still in the channel).
- **A reply** in the thread takes the account of the root's issue; no issue: ignored.
- It then runs the usual `customers.chatMessage` hooks with that account and `inbox: "email"`,
  so participants and the support-issue hook work as for a linked channel, except that the hook
  takes the account from the payload instead of `customer_channel_links`.

Author sides: an email shadow is `External` (provider `email`): a customer. Team members replying
from Hazel are team. The quick-follow-up merge does not apply to email (each email thread is its own
conversation; a new thread from the same person is a new issue).

## Setup and RPCs

- `chatSync.email.create` `{ organizationId, displayName, supportAddress?, hazelChannelId }`
  (integration managers): makes the connection (id generated server side, never chosen by the
  client), its one link (two-way) and indexes both. Answers the connection, the link and the
  inbound address.
- `chatSync.email.update` `{ organizationId, syncConnectionId, displayName?, supportAddress? }`:
  renames the mailbox, changes or clears the reply-to address (written to the link's settings and
  re-projected to the channel).
- Removing: `chatSync.connection.delete`, like any connection.
- `chatSync.connection.create` refuses `provider: "email"`: a mailbox id is never the client's.

Settings → Chat sync shows an **Email** card: create a mailbox (name, support address, channel),
then the forwarding address to copy with steps for Google Workspace and Microsoft 365, and each
mailbox with its channel, address, edit and remove.

## Configuration

| Env                    | Default            | What                                                                          |
| ---------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `INBOUND_EMAIL_DOMAIN` | `inbound.hazel.sh` | Where mailboxes receive. Email Routing on it (catch-all → the api Worker).    |
| `SUPPORT_EMAIL_DOMAIN` | `mail.hazel.sh`    | Where replies are sent from: onboarded to Cloudflare Email Sending (invites). |

Email Routing on the inbound domain is set up once in the dashboard (Email → Email Routing →
the subdomain → catch-all → Send to Worker `api`), as the sending domain was; the deploy token has
no Email permissions. Locally, `alchemy dev` writes sent mail to `.alchemy/local/email`.

## Later

- Attachments in both directions as files (inbound needs an upload from the MIME parts).
- Unmatched senders: an issue without an account, or an account made from the domain.
- Sending from the customer's own domain (DKIM onboarding per org).
- Gmail / Outlook OAuth instead of forwarding; a new outbound email from Hazel (no inbound first).
