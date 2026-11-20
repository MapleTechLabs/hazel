# Customers: linked channels

Link any channel of the org to a customer account, Pylon style: the channel where the team talks
to that customer. It can be a Hazel channel, a Slack or Discord channel mirrored by chat sync, or
a Hazel Connect channel shared with the customer's own org. All three are ordinary rows in
`channels` of the linking org (a Connect guest org has its own mount row), so one link shape fits
all of them.

## Rules

- Links are per customer, not per environment: for a customer with several environments (a US
  and an EU org, `customers.account.link`) a channel is linked to the group. The link is stored on
  the group's primary whichever environment it was linked from, every environment's page shows
  the same channels, and chat names the primary. Linking an account into a group, or making
  another environment primary, moves the links to the new primary; unlinking an environment
  leaves them with the customer. A link stored on an environment before this still shows under
  its primary.
- An account has any number of channels; a channel has at most one customer. Linking a channel
  that belongs to another account moves it (both accounts get a `hazel` timeline event:
  `channel.unlinked`, `channel.linked`).
- Only `public` and `private` channels can be linked (not threads or DMs).
- Linking is queue work: any member of the org (`customer_members`) may link and unlink. For both,
  the caller must see the channel (`channel_access`); a channel they cannot see answers `not_found`, the same as
  one that does not exist.
- Customer data stays internal: the projection streams only to org members who see the channel,
  never to Connect guests.

## Data

| Where                           | Table                    | What                                                                                                                                                                         |
| ------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CustomersObject` (`customers`) | `customer_channel_links` | The link (authoritative). `accountId`, `channelId`, `linkedBy` (null: linked automatically), soft delete; partial unique index on `channelId` while live. Synced to members. |
| `OrgObject` (`org`), projection | `channel_customers`      | `channelId` → `accountId`, `accountName`, `accountLogoUrl` and the glance (below). Written only by `org.setChannelCustomers`. Synced with `byChannel` (members who see it).  |

## Flow

1. `customers.channel.link` (routed to the org's `CustomersObject`): `requireMember`, the account
   exists, then the call `org.customerChannel` asks the `OrgObject` whether the channel exists,
   is linkable and visible to the caller (`ok | not_found | not_linkable`).
2. In one transaction: the old live link of the channel (if any) is soft-deleted, the new one
   inserted, events written, and `publishChannelCustomers` enqueues `org.setChannelCustomers`.
3. `org.setChannelCustomers` is a full snapshot of every live link of a live account (named by
   its group's live primary, with its glance), versioned like `customers.setMembers` (an older version is
   dropped); the receiver writes only what changed. Its sender guard accepts only the org's own customers object.
4. The snapshot is sent only when its SHA-256 fingerprint (over every field) changed: after link /
   unlink, after a person changes an account's name or owner (one or in bulk) or a signal's status
   (assign, snooze, done, dismiss, reopen), and at the end of every compute (names, numbers,
   health and signals set by sources and rules; accounts a source deleted).
5. Org deletion purges `customer_channel_links` with the rest of the customer data.

Deleting a channel that has a customer: the `OrgObject` sends `customers.channelDeleted` (from
`channel.delete`, only when `channel_customers` has the channel; sender guard: the org's own
object). The customers object drops the live link, writes a `channel.deleted` event on the
account and sends a new snapshot.

## In the channel: the account at a glance

Each `channel_customers` row also carries the customer's glance, so chat shows the account without
opening the Customers source (which would snapshot every account and signal, and ignore channel
visibility). The columns came after the table: all nullable or defaulted (objects migrate lazily),
and the payload's glance fields are optional (a snapshot queued before them still applies; the
next one, whose fingerprint differs, fills them).

| Field                           | From                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `healthStatus`, `healthScore`   | The customer (the group's primary).                                                                       |
| `healthWhy`                     | The scored component with the lowest score in its latest `customer_health_daily` (7 d).                   |
| `ownerUserId`                   | The customer.                                                                                             |
| `lifecycleStage`, `planName`    | The group's rules (`group-facts.ts`): the most advanced stage; the primary's plan, else an environment's. |
| `mrrMinor`, `currency`          | Σ over the group (compute keeps MRR in the reporting currency).                                           |
| `seatsUsed`, `seatsLimit`       | Σ over the group (null when none is known).                                                               |
| `lastActiveDay`                 | The group's latest `lastActiveAt`, as a day, so activity does not resend it hourly.                       |
| `openSignalCount`, `topSignals` | The group's `open` signals; the top 3 by priority (id, title, reason, kind, severity).                    |
| `sourceLinks`                   | One `externalUrl` per provider from live account refs, the customer's own first.                          |

Writes reach only linked channels' rows (tens per org), at most once a compute, and only the rows
that changed. Same visibility as the name: org members who see the channel, never Connect guests.

A row projected before the glance (an org with no snapshot since the deploy: the next compute, within
the hour, sends one) has no stage; the card then shows only the name and the way to the customer
page, not blanks that read as an empty account.

UI (`src/page/chat/customer-card.ts`): the header chip shows the health dot and the name. On
desktop, hovering it shows the card after 350 ms; it stays while the pointer is on the chip or the
card (200 ms grace), and a click pins it until Escape or a click outside. On a phone a tap opens
the same card in a bottom sheet. The card: logo, name (to the customer page), health badge and
stage, the health reason (or "No health score yet"), revenue and plan, owner, seats, last active,
open signals (count, top 3, "N more", the queue), then the customer page and provider links. The
card takes a `support` slot between the signals and the links for support issues and SLAs
(later sessions). Gallery: `customer-card.gallery.ts`.

## Client

- `src/customers/channels.ts`: `channelOptionsStream` (the org's linkable channels with origin
  `hazel | slack | discord | connect`, from `channels` + active chat-sync links + Connect mounts),
  `channelLinksStream` (Customers source), `channelCustomerStream` (org source), the optimistic
  `linkChannelAction` / `unlinkChannelAction`, and `channelMark`.
- Customer page sidebar: a **Channels** section (linked channels with their platform mark, open in
  chat, unlink; a searchable "Link channel" picker that says when a channel is linked elsewhere).
- Chat sidebar: a **Customers** section (after the custom sections, before DMs) lists the linked
  channels the user joined, by customer name then channel name; they leave their own section,
  and a favorite stays only in Favorites. Each row shows the customer's logo in place of its `#`
  (its initial on a tint when it has none; a lock badge on private channels). It reads `channel_customers`, so it needs no Customers
  source (`shell/channels-sidebar/customer-channels.ts`). Keyboard channel navigation follows the same order.
- Chat header: a quiet customer chip beside the channel name, opening the customer card (above).
- Channel settings → Overview: a **Customer** section to link, change or unlink. The customers list
  loads (opening the Customers source) only while its picker is open.

## Suggested links

Hazel suggests which customer a channel belongs to and says why ("3 of 4 external members have
@acme.com, Acme's domain"). Nothing is linked without a click, except a Connect channel whose
guests are clearly one account's contacts.

### Evidence (`org.channelEvidence`, a call to the `OrgObject`)

For each live `public` / `private` channel:

- **Origin**: `connect` (an active Connect mount), `slack` / `discord` (an active chat-sync link),
  else `hazel`.
- **Workspaces**: each chat-sync link's workspace (the Slack workspace the org installed from, the
  Discord guild), plus every other Slack team its authors come from: a Slack Connect team, marked
  `external`.
- **External members** (at most 200, newest first): Connect guests with their email (the org's
  `users` projection), and chat-sync authors from an external Slack team.
  `chat_sync_channel_authors` (org store, never synced) records each chat-sync author per channel
  as messages arrive: their Slack team or Discord guild, and their email when Slack shares it.
  Slack only shares it with the `users:read.email` scope, so a workspace that installed before
  this has no emails until it approves the new scope. Authors seen before the channel's current
  Slack mirror was created are ignored. `externalMemberCount` says how many there are in all.
- **Connect, the accepting side**: an org that accepted a share holds no participants (the host
  does). Its evidence names the share (`connect: { hostOrganizationId, conversationId }`), and the
  `CustomersObject` asks the host once per host org with `org.connectGuestEvidence`. The host
  answers only for conversations it hosts on which that org has an active mount, with the
  participants of every other org (emails, newest first, at most 200, and their count).

### Scoring (`packages/domain/src/customers/channel-suggestions.ts`, pure)

Matched against live accounts (name, `domains`), contact emails and the channels already linked.
Each reason has a weight, and reasons compound (`1 - Π(1 - w)`):

| Reason      | When                                                                                                                                                      | Weight                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `contacts`  | external members who are the account's contacts (exact email)                                                                                             | 60 + 35 × share                      |
| `domain`    | external members at one of the account's domains (free-mail domains never count)                                                                          | 40 + 45 × share                      |
| `workspace` | other channels of the same Slack Connect team (or of the same Discord guild, ≥ 2) are linked to this account and to no other                              | Slack 75, Discord 35 + 10 each, ≤ 60 |
| `name`      | the channel's name (or a Discord guild's / Slack Connect team's) contains the account's name or a domain's first label (punctuation dropped, ≥ 4 letters) | channel 30, workspace 50             |

The org's own Slack workspace is never evidence. Suggestions under 30 are dropped; 75 and up are
`strong`; at most 3 per channel.

**Auto-link**: a Connect channel whose best match has at least half its guests as that account's
contacts, with no other account matching by contact or domain, counted over every guest: a channel
whose evidence is a sample (more guests than were sent, or a host that could not be reached) is
only suggested. It links like a click (`linkedBy` null, a `channel.linked` event that says why,
with reason kinds and counts but no names). A channel with any link history (linked or
unlinked before) or a decided suggestion is never auto-linked: once someone unlinks it, it stays
manual.

### Storage and lifecycle (`customer_channel_suggestions`, `CustomersObject`)

One row per (channel, account): `score`, `reasons`, `status` `open | dismissed | accepted`,
`decidedBy`, `decidedAt`. Refreshed at the end of every compute, and for one channel when the
suggestions RPC names it (a channel shared a moment ago). A refresh skips a channel a newer refresh already scored, updates open rows, deletes open rows that no
longer score, and leaves decided rows alone: a dismissed account is never suggested for that
channel again. Linking a channel (by hand, by accepting, or automatically) accepts that pair and
drops the channel's other open suggestions.

### RPCs and visibility

- `customers.channel.suggestions` `{ accountId?, channelId? }`: open suggestions, best first, only
  for channels the caller sees (`org.visibleChannels`). Not synced, so a private channel's evidence
  never reaches a member who cannot see it, and nothing reaches Connect guests.
- `customers.channel.suggestion.accept` links through the same path as `customers.channel.link`
  (same checks); `.dismiss` remembers the dismissal. Both answer `not_found` for a channel the
  caller cannot see.

### Client

`src/customers/suggestions.ts` (fetch, accept, dismiss, the row) and `suggestion-prompt.ts` (the
one-channel prompt). Reasons are worded only by `describeReason`. Accepting or dismissing hides the
row at once, refetches, and restores it with a toast if the write fails. Nothing is requested for
someone who is not an org member.

- Customers → Overview: a **Suggested channel links** card (top 5, channel → account, the top
  reason with the rest on hover, Link / dismiss), hidden when there are none.
- Customer page → Channels: a **Suggested** group above "Link channel"; a link made automatically
  reads "Linked automatically".
- Channel settings → Overview → Customer: "Looks like Acme" with the top reason, Link / Dismiss,
  while the channel has no customer.
- Right after a chat-sync link is created (Settings → the connection), or a Connect invite is
  accepted (the new channel found from its Connect mount once the write syncs): "#channel looks
  like Acme".

## Later

- Issues from messages, SLAs and first-response times per linked channel.
- Open support issues and SLA state in the card's `support` slot.
- Discord members' identity: Discord shares no emails, so Discord channels match by guild and
  name only.
