# Customers: who wrote a message (author side)

Every message in a channel linked to a customer (`channels.md`), or in a thread of one, has an
author side: **customer**, **team**, **bot** or **unknown**, and a **reason** that names the rule
that decided it. Support issues ("waiting on us / on the customer") and SLAs ("first team reply
after a customer message") build on this.

## The rules

`classifyAuthor(facts, override)` in `packages/domain/src/customers/author-side.ts` (pure, tested).
First match wins:

| Facts about the author (`AuthorFacts`)                      | Side     | Reason                     |
| ----------------------------------------------------------- | -------- | -------------------------- |
| A bot, an integration, a webhook (any machine user)         | bot      | `bot` (overrides ignored)  |
| A member set an override                                    | as set   | `override`                 |
| Member of the org                                           | team     | `org_member`               |
| Was a member of the org                                     | team     | `former_member`            |
| Member of another org in a Hazel Connect channel            | customer | `connect_guest`            |
| Slack author from another workspace (Slack Connect)         | customer | `external_other_workspace` |
| Slack author from our own workspace, Hazel account unlinked | team     | `external_home_workspace`  |
| Slack or Discord author, workspace unknown (Discord always) | customer | `external`                 |
| Nothing known                                               | unknown  | `unknown`                  |

Notes:

- A Slack or Discord author who linked their Hazel account is that Hazel user: chat sync writes as
  them and the reconciler moves their past messages, so they classify as `org_member`.
- Chat-sync shadows are machine users that chat sync makes org members on first sight; the facts
  read the shadow's `externalId` (`slack-user-…`, `discord-user-…`) before membership.
- The author's Slack workspace comes from `users.info` (`team_id`), compared at ingest with the
  workspace the org connected, and is kept on the author's row (`externalWorkspace`).
- Shadows have no real email, so they are not matched to `customer_contacts`. Connect guests are:
  `customer_chat_participants.contactId` is the account's contact with the same email.
- `isConversational(side)`: customer and team take part in a conversation; bots and unknowns
  never decide "waiting on" or an SLA.

## Where it lives

| Store                           | Table                        | What                                                                                                                                                 |
| ------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OrgObject` (`org`)             | `customer_chat_authors`      | One row per author seen in a linked channel: `side`, `reason`, `override` (+ by, at), `externalWorkspace`. Synced to members (never Connect guests). |
| `CustomersObject` (`customers`) | `customer_chat_participants` | Per `(accountId, userId)`: side, reason, `contactId`, name, avatar, first and last message, last channel. Synced to members.                         |

The org classifies because only it knows the facts (members, the `users` projection with shadows
and bots, installed bots, Connect participants). Nothing is stamped on messages: an override, or a
channel linked later, applies to past messages too.

## Flow

1. A message is created in a channel. Its `ChannelObject` already sends `org.messageCreated` to
   the org (and the host org forwards it to each Connect guest org's mount); it now carries the
   message's `createdAt`.
2. The `OrgObject` checks `channel_customers` for the channel (a thread: its parent). Linked:
   `classifyChatAuthor` updates `customer_chat_authors` if the side changed and enqueues
   `customers.chatMessage` to its `CustomersObject`:
   `{ accountId, channelId (linked), messageChannelId, messageId, createdAt, author: { userId, side, reason, name, avatarUrl, email } }`.
3. The `CustomersObject` runs `customerChatMessageHooks` (`apps/backend/src/worker/objects/customers/chat.ts`)
   in the delivery's transaction. The first hook keeps `customer_chat_participants`.
4. Override: `customers.chatAuthor.setSide { organizationId, userId, side: "team" | "customer" | null }`
   (any member, people only; routed to the `OrgObject`). The org updates the row and sends
   `customers.chatAuthorChanged`; the participants follow.
5. Backfill: the first time the org sees a channel linked (a new link, or links from before this
   feature on the next snapshot), it sends `channel.reportChatAuthors` to the channel's object,
   which answers `org.chatAuthorsReported` with each author's first and last live message and its
   threads (each asked in turn, up to 500); the org classifies them and sends
   `customers.chatAuthorsBackfill`. A Connect guest org's mount is not backfilled (only the host org
   may ask the host channel); its authors come in as they write.

## Building on it (support issues, SLAs)

- Add a hook to `customerChatMessageHooks`. It gets every message of every linked channel in order
  of delivery, with `author.side` as classified when it was written, and runs inside the
  `CustomersObject`: read and write only the customers store, send anything else through the outbox.
- Waiting on: the side of the last conversational message (`isConversational`) of the channel or
  thread. First team reply: the first `team` message after a `customer` one, by `createdAt`.
- An override changes past sides: `customers.chatAuthorChanged` is the signal to recompute what
  depends on that author.
- The backfill gives participants only, not messages; history before the link does not open
  issues or SLAs.
