# Customers: support issues and the inbox

Pylon's core on Hazel: a conversation a customer starts in a linked channel (`channels.md`) is an
**issue**, triaged in the **Support inbox** (Customers → Support inbox, next to Needs attention).
Replies still happen in the channel or thread; the inbox links into chat.

## Rules

- **Opening.** A customer's top-level message in a linked channel opens an issue (status `new`).
  The message is the issue's root, and its thread, once it has one, is the issue's conversation.
  A member can also open one on any top-level message of a linked channel, any author ("Create
  issue" in chat, `customers.issue.createFromMessage`); the message's live issue, if any, is
  answered as it is.
- **Quick follow-ups merge.** A customer's next top-level message joins their own issue instead of
  opening another when that issue is `new` or `waiting_on_us`, has no team reply since the
  customer last wrote, and its last message is at most 10 minutes old ("hi" then "our dashboard is
  broken"). It counts on the issue (`messageCount`, `lastCustomerMessageAt`); replies in the
  joined message's own thread are not tracked.
- **Status** (`new | waiting_on_us | waiting_on_customer | on_hold | closed`), from each message in
  the issue's thread, by who wrote it (`AuthorSide`):

    | Message by   | `new`               | `waiting_on_us`     | `waiting_on_customer` | `on_hold`     | `closed`                                                    |
    | ------------ | ------------------- | ------------------- | --------------------- | ------------- | ----------------------------------------------------------- |
    | customer     | new                 | waiting_on_us       | waiting_on_us         | waiting_on_us | **reopens**: waiting_on_us, `reopenCount + 1`, `reopenedAt` |
    | team         | waiting_on_customer | waiting_on_customer | waiting_on_customer   | on_hold       | closed                                                      |
    | bot, unknown | —                   | —                   | —                     | —             | —                                                           |

    Bots and unknown authors move only `lastMessageAt` and `messageCount`. A message older than the
    issue's last one (an out-of-order delivery) fills timestamps but never moves the status.
    A member sets any status by hand; closing records `closedAt` / `closedByUserId`, and setting a
    closed issue to anything else reopens it.

- **A team top-level message** opens nothing, nor does a reply under a message that has no issue.
- **Deleting the root** before anyone else wrote in the issue deletes the issue; one with a
  conversation stays.
- Assignee (an org member), priority (`none | low | medium | high | urgent`) and tags: any member
  (`customers.issue.update`). Status changes, closes, reopens and assignments are `hazel` events on
  the account's timeline (`issue.opened`, `issue.status_changed`, `issue.closed`,
  `issue.reopened`, `issue.assigned`).

## Who wrote it

Each message's `AuthorSide` (`customer | team | bot | unknown`) is the author-side classifier's
(`author-side.md`), as the org decided it when the message was written. An issue opened by hand
takes its root author's side from `customer_chat_participants` (the classifier's last answer for
them), else team for a member, else unknown. An override changing someone's side later
(`customers.chatAuthorChanged`) does not rewrite existing issues.

## Data and flow

| Where                               | Table / effect                    | What                                                                                                                          |
| ----------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `CustomersObject` (`customers`)     | `customer_issues`                 | The issue. Partial unique `(sourceChannelId, rootMessageId)` while live. Synced to members: unclosed, and closed for 30 days. |
| `ChannelObject` → `OrgObject`       | `org.messageCreated`              | Carries `threadRootMessageId` in a thread (optional: older deliveries have none).                                             |
| `OrgObject` → `CustomersObject`     | `customers.chatMessage`           | The author-side relay; it now also carries `threadRootMessageId` and the text (≤ 500 characters, the issue's title).          |
| `OrgObject` → `CustomersObject`     | `customers.supportMessageDeleted` | A root message deleted in a linked channel.                                                                                   |
| `CustomersObject` → `ChannelObject` | call `channel.supportMessage`     | For an issue opened by hand: the message (author, time, text, thread) if the caller reads the channel.                        |

1. `customers.chatMessage` (`author-side.md`) runs `customerChatMessageHooks` in the customers
   object; `supportIssueHook` (`customers/issues.ts`) is the one after participants. It finds the
   live link in `customer_channel_links` (the issue's account is the link's) and applies the rules
   above. Hazel, Slack, Discord and Connect channels arrive the same way.
2. A reply delivered by an older sender (no `threadRootMessageId`) cannot be placed and is skipped.
3. An issue learns its thread from the first reply (`threadChannelId`).
4. Every write to `customer_issues` goes through `insertIssueRow` / `updateIssueRow`, which end in
   `issueWritten(before, after)` in the same transaction: derived state (SLAs) hooks in there.
   Only the org-deletion purge deletes rows outside it.

Every handler touches only its own store; nothing reads across objects.

## SLA contract (for SLAs, session 5)

All on `customer_issues`, ISO instants in the sync stream, epoch ms in the client's `IssueRow`:

| Field                       | Meaning                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `openedAt`                  | The root message's time.                                                                                                |
| `firstCustomerMessageAt`    | The customer's first message (the root when a customer opened it; null for an issue a member opened on a team message). |
| `lastCustomerMessageAt`     | The customer's latest message.                                                                                          |
| `firstTeamReplyAt`          | **First response**: the earliest team message in the issue (a late delivery of an earlier one moves it back).           |
| `lastTeamReplyAt`           | The team's latest message. Waiting on us since `lastCustomerMessageAt` when that is later.                              |
| `lastMessageAt`             | Either side's latest message.                                                                                           |
| `closedAt`                  | When it was closed; null while open.                                                                                    |
| `reopenedAt`, `reopenCount` | Last reopen (resolution time counts from here on a reopened issue) and how many.                                        |
| `status`, `priority`        | As above.                                                                                                               |

- First response time = `firstTeamReplyAt − openedAt` (or `− firstCustomerMessageAt`).
- Response overdue = `status in (new, waiting_on_us)` and `now − max(lastCustomerMessageAt,
  reopenedAt)` past the plan's target.
- Resolution time = `closedAt − (reopenedAt ?? openedAt)`.

## Client

- `src/customers/issues.ts`: `IssueRow`, labels, `issuesStream`, `myWaitingIssueCountStream`
  (sidebar badge: new or waiting on us, mine or unassigned), `issueAtMessageStream` (one root's
  issue), `updateIssueAction`, `createIssueFromMessageAction`.
- `page/customers/inbox/`: tabs Open (new, waiting on us, waiting on customer) · On hold · Closed (30
  days). Filters: assignee (default "Mine or unassigned"), waiting on us, status, priority, account;
  search on title, customer and tags. Open sorts waiting on us first, then priority, then longest
  waiting. Keys: `k`/`j` move, `a` assign, `i` assign to me, `s` status, `p` priority, `c` close /
  reopen, Enter open the thread (the root's channel before it has one), `o` open the customer, `/`
  search. The keyboard filter is shared with Needs attention (`customers/ui/queue-keys.ts`).
- Chat: the thread panel of a linked channel's thread shows the issue's status and assignee (or
  "Create issue"); a "Create issue" message action on top-level messages of linked channels
  (`page/chat/issue-control.ts`). The channel header can host the same chip later.
