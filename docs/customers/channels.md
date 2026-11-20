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

| Where                           | Table                    | What                                                                                                                                                                        |
| ------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CustomersObject` (`customers`) | `customer_channel_links` | The link (authoritative). `accountId`, `channelId`, `linkedBy`, soft delete; partial unique index on `channelId` while live. Synced to members.                             |
| `OrgObject` (`org`), projection | `channel_customers`      | `channelId` → `accountId`, `accountName`, `accountLogoUrl` and the glance (below). Written only by `org.setChannelCustomers`. Synced with `byChannel` (members who see it). |

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

## Later

- Suggest links: Slack Connect / Discord guild ids and Connect guest org domains matched to
  account domains.
- Issues from messages, SLAs and first-response times per linked channel.
- Open support issues and SLA state in the card's `support` slot.
