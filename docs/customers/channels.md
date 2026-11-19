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

| Where                           | Table                    | What                                                                                                                                                 |
| ------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CustomersObject` (`customers`) | `customer_channel_links` | The link (authoritative). `accountId`, `channelId`, `linkedBy`, soft delete; partial unique index on `channelId` while live. Synced to members.      |
| `OrgObject` (`org`), projection | `channel_customers`      | `channelId` → `accountId`, `accountName`, `accountLogoUrl`. Written only by `org.setChannelCustomers`. Synced with `byChannel` (members who see it). |

## Flow

1. `customers.channel.link` (routed to the org's `CustomersObject`): `requireMember`, the account
   exists, then the call `org.customerChannel` asks the `OrgObject` whether the channel exists,
   is linkable and visible to the caller (`ok | not_found | not_linkable`).
2. In one transaction: the old live link of the channel (if any) is soft-deleted, the new one
   inserted, events written, and `publishChannelCustomers` enqueues `org.setChannelCustomers`.
3. `org.setChannelCustomers` is a full snapshot of every live link of a live account (named by
   its group's live primary), versioned like `customers.setMembers` (an older version is
   dropped); the receiver writes only what changed. Its sender guard accepts only the org's own customers object.
4. The snapshot is sent only when its SHA-256 fingerprint changed: after link / unlink, after an
   account renamed by hand, and at the end of every compute (names set by a source, accounts a
   source deleted).
5. Org deletion purges `customer_channel_links` with the rest of the customer data.

Deleting a channel that has a customer: the `OrgObject` sends `customers.channelDeleted` (from
`channel.delete`, only when `channel_customers` has the channel; sender guard: the org's own
object). The customers object drops the live link, writes a `channel.deleted` event on the
account and sends a new snapshot.

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
- Chat header: a quiet customer chip beside the channel name, opening the customer page.
- Channel settings → Overview: a **Customer** section to link, change or unlink. The customers list
  loads (opening the Customers source) only while its picker is open.

## Later

- Suggest links: Slack Connect / Discord guild ids and Connect guest org domains matched to
  account domains.
- Issues from messages, SLAs and first-response times per linked channel.
- Account context in the channel (health, MRR, open signals) without opening Customers.
