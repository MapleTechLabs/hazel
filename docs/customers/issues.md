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

- **By hand on a team message** (a teammate relays what the customer said elsewhere), the issue
  starts as waiting on us, with no customer timestamps. A thread that already has replies when the
  issue is opened by hand counts from then on: earlier replies are not counted.
- **A team top-level message** opens nothing, nor does a reply under a message that has no issue.
- **Deleting the root** before anyone else wrote in the issue deletes the issue; one with a
  conversation stays.
- Assignee (an org member), priority (`none | low | medium | high | urgent`) and tags: any member
  (`customers.issue.update`). Status changes, closes, reopens and assignments are `hazel` events on
  the account's timeline (`issue.opened`, `issue.status_changed`, `issue.closed`,
  `issue.reopened`, `issue.assigned`).

## Triage

A linked channel is a conversation, and most of what a customer writes there is not a request
("yup", "thanks", talk about other tools). Left alone, each of those opens an issue, and the inbox
fills with rows nobody can answer. So every issue a customer's message opens in a linked channel is
put to a **decision model** right after it opens. Email inboxes are not triaged, and no email is
sent to the model: a mail to a support address is a request by where it was sent. An email
conversation a member filed by hand comes back on the customer's next reply, unasked.

- **The model.** TypeSafe's Jev (`typesafe/jev-1.14`) through OpenRouter's Decisions API
  (`POST /api/alpha/decisions`, `services/decisions.ts`). It is not a chat model: it answers yes/no
  questions about a `state` with a probability and writes no text, so there is nothing to parse and
  nothing a customer's message can make it say. It needs `OPENROUTER_API_KEY`; without it triage
  does nothing.
- **What it is asked** (`customers/triage.ts` `triageRequest`). The state is the message, the
  channel's messages before it (each by side: customer, team, bot; people are told apart, never
  named) and, when the team wrote one, what it supports (`customer_settings.supportTriage.about`).
  The questions, one judgment each:
    - `support`: does the message need the team's support?
    - `chatter`: is it only conversation, with nothing to answer, fix or do?
    - `same_N`, one per recent conversation of the channel (open, or filed as chatter, active in
      the last 24 hours, at most 4): is the message part of that conversation?
- **What the answers decide** (`@hazel/domain/customers` `decideTriage`, pure):
    - **Merge**: a `same_N` at 0.7 or more folds the issue into that conversation (the highest
      wins): its messages count there, their threads lead there, and the issue is gone. A support
      request never joins a conversation filed as chatter: it would be hidden with it.
    - **Chatter**: `support` at most 0.3 **and** `chatter` at least 0.7. Both have to agree,
      because filing a real request costs more than leaving small talk in the inbox. The issue
      gets `triage: "chatter"` and is closed: no queue, badge or SLA clock counts it, and its
      "Issue opened" leaves the account's timeline.
    - **Support**: anything else. `triage: "support"`, and nothing else changes.
- **It fails open.** Off, no key, a refused or unanswered question, a message older than 30 minutes
  by the time the model is reached: the issue stays in the inbox as it opened. A provider error is
  retried from the outbox until that half hour passed. Only an issue nobody touched (still `new`,
  unassigned, unanswered, no priority or tags, not opened by hand) is ever filed or folded. What a
  member decides while the model is answering stands: a request is not folded into a conversation
  filed meanwhile, and a filing made meanwhile is not undone by the reply's answer.
- **A filed conversation is still followed.** Messages in its thread count on it and it stays
  filed; each customer reply there asks the model again about that reply, and the conversation
  comes back as waiting on us unless the reply is chatter too (or the model cannot be asked).
  Brought back, its SLA clocks start then: the time it sat filed was nobody's to answer in.
- **By hand.** `customers.issue.update` with `triage: "chatter"` files an issue ("Not support",
  `x` in the inbox); `triage: "support"`, or any status but closed, brings a filed one back as
  waiting on us (`x` again, "Mark as support"). Neither counts as a close or a reopen in
  `reopenCount`. In chat a filed conversation reads as a thread with no issue, and "Create issue"
  brings it back.
- **Settings** (Customers → Settings → Support SLAs → Triage, admins): on or off, and what the team
  supports. `triageScore` keeps the model's `support` probability on the row; `triagedByUserId` is
  the member who decided by hand (null: the model, or nobody).

The thresholds (`TRIAGE_YES` 0.7, `TRIAGE_NO` 0.3) are TypeSafe's suggested starting points. They
were checked once against `jev-1.14` (2026-11-25) on 29 made-up messages, each with and without
the team's description, not on real conversations:

- Every request was kept (`support` 0.73 to 0.99), those naming another company's tool included
  ("your SDK crashes when we also run the Datadog agent"), and every message that continued a
  conversation was folded into the right one (`same_N` 0.92 to 0.96, against 0.03 to 0.33 for a
  new topic).
- Greetings, thanks, acknowledgements and off-topic questions were filed. Every miss was chatter
  left in the inbox, none a request filed.
- A follow-up reads as low `support` on its own ("the VAT number is DE…": 0.11 to 0.35) and as low
  `chatter` too, which is why both questions have to agree.
- Without the team's description, a question about another company's product reads as a product
  question and stays (`support` 0.48 to 0.98): the description is what tells them apart.
- An answer took about 200 ms and cost about $0.00003.

`triage.outcome`, `triage.support` and `triage.chatter` are on the `Customers.triageIssue` span, and
the Filtered tab is where a wrong call shows.

## Who wrote it

Each message's `AuthorSide` (`customer | team | bot | unknown`) is the author-side classifier's
(`author-side.md`), as the org decided it when the message was written. An issue opened by hand
takes its root author's side from `customer_chat_participants` (the classifier's last answer for
them), else team for a member, else unknown. An override changing someone's side later
(`customers.chatAuthorChanged`) does not rewrite existing issues.

## Data and flow

| Where                               | Table / effect                    | What                                                                                                                                |
| ----------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `CustomersObject` (`customers`)     | `customer_issues`                 | The issue. Partial unique `(sourceChannelId, rootMessageId)` while live. Synced to members: unclosed, and closed for 30 days.       |
| `ChannelObject` → `OrgObject`       | `org.messageCreated`              | Carries `threadRootMessageId` in a thread (optional: older deliveries have none).                                                   |
| `OrgObject` → `CustomersObject`     | `customers.chatMessage`           | The author-side relay; it now also carries `threadRootMessageId` and the text (≤ 500 characters, the issue's title).                |
| `OrgObject` → `CustomersObject`     | `customers.supportMessageDeleted` | A root message deleted in a linked channel.                                                                                         |
| `CustomersObject` → `ChannelObject` | call `channel.supportMessage`     | For an issue opened by hand: the message (author, time, text, thread) if the caller reads the channel.                              |
| `CustomersObject` → `ChannelObject` | call `channel.supportContext`     | For triage: the channel's messages up to the judged one, its root always included (≤ 500 characters each). Read for the model only. |
| `CustomersObject` (its own outbox)  | `ai.triageIssue`                  | The model call, 2 s after the commit that opened the issue (or a customer's reply in a filed conversation).                         |

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
  days) · Filtered (filed as not support, 30 days; in no other tab). Filters: assignee (default "Mine or unassigned"), waiting on us, status, priority, account;
  search on title, customer and tags. Open sorts waiting on us first, then priority, then longest
  waiting. Keys: `k`/`j` move, `a` assign, `i` assign to me, `s` status, `p` priority, `c` close /
  reopen, `x` not support / mark as support, Enter open the thread (the root's channel before it has one), `o` open the customer, `/`
  search. The keyboard filter is shared with Needs attention (`customers/ui/queue-keys.ts`).
- Chat: the thread panel of a linked channel's thread shows the issue's status and assignee (or
  "Create issue"); a "Create issue" message action on top-level messages of linked channels
  (`page/chat/issue-control.ts`). The channel header can host the same chip later.
