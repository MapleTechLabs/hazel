# Customers: support SLAs and response times

Targets for how fast the team answers and resolves a customer's support issue, live "due in 12m /
breached 1h ago" state on each issue, warnings before and at a breach, overdue signals in Needs
attention, and response-time reports. Builds on support issues (`issues.md`, the issue record and
its statuses) and the author classifier (customer vs team messages).

Status: implemented (clocks, policies and settings, the issue hook, alarm, notifications, signals,
the report and UI). Open items: §7.

## 1. Decisions

- **Hours per policy.** The org has one working week (`customer_settings.businessHours`: time zone,
  days, start and end; default Mon–Fri 09:00–17:00 UTC). Each policy counts either `business`
  hours or `always` (24/7). A customer writing Fri 16:50 with a 1 h target is due Mon 09:50 on
  business hours, Fri 17:50 on 24/7. No holidays yet.
- **Two clocks.** _Reply due_ and _resolution_ (below). The customer writing again after a team
  reply (which also reopens a closed issue) starts a new reply-due clock with the first-response
  target: it shows live and warns, but only the first one counts as first response time in reports.
  A member reopening by hand resumes resolution only. Messages delivered late (written before the
  last reply or the close) change nothing but an earlier first response.
- **Resolution pauses** while the issue waits on the customer or is on hold.
- **SLA signals cover every customer.** `response_overdue` and `resolution_overdue` skip the org's
  Needs attention coverage (stages, required sources) but respect the rule's own scope: a Slack-only
  free customer waiting four hours still shows.
- **Reports:** four tiles on the Customers overview, linking to a Support report page.

## 2. Policies

`customer_sla_policies` (store `customers`, synced to members, soft delete):

| Column          | What                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `name`          | e.g. Standard, Enterprise                                                                                                 |
| `position`      | The order; first match wins                                                                                               |
| `enabled`       |                                                                                                                           |
| `appliesTo`     | `accountIds`, `planNames`, `tagsAny`; all empty = a default policy                                                        |
| `targets`       | Per issue priority (`urgent`, `high`, `medium`, `low`; `none` uses `medium`): `firstResponseMinutes`, `resolutionMinutes` |
| `hours`         | `business` or `always`                                                                                                    |
| `warnBeforePct` | Warn this share of the target before it is due (default 25%; 0 = only at breach)                                          |

An account's policy (`policyFor`): the first enabled policy naming it by id, else the first naming
its plan or one of its tags, else the first default one; none = no SLA. Every org starts with
**Standard** (business hours, any account): urgent 1 h / 8 h, high 2 h / 16 h, medium 4 h / 24 h,
low 8 h / 40 h (first response / resolution, working time). Existing orgs get it from migration
`0023_customer_slas`.

RPCs (`CustomerSlaRpcs`, admins and owners): `customers.slaPolicy.create | update | delete |
reorder` (the whole order, each live policy once) and `customers.businessHours.update`. A change
applies to issues opened or re-targeted after it; running clocks keep their deadlines.

## 3. Clocks (`packages/domain/src/customers/sla.ts`)

One pure reducer, `stepSla(ctx, state, event)`, over an issue's events: `Opened`, `CustomerMessage`,
`TeamReply`, `Status`, `Priority`. The object folds each issue change into the stored state; the
replay fixture folds a whole conversation; reports read the result.

- **Reply due** (`state.reply`): starts at open (`first: true`) and when the customer writes while
  no reply is due; met by the next team reply; stopped when the issue closes first. The first one,
  once met, is frozen as `state.firstResponse`, which reports count.
- **Resolution** (`state.resolution`): runs from open; pauses on `waiting_on_customer` and `on_hold`
  (working time so far kept in `consumedMs`); runs again on `new` / `waiting_on_us` or a customer
  message; `resolvedAt` on close. A reopen counts on from what was consumed.
- **Priority change** re-targets running clocks from their start; a warning or breach already sent
  is cleared only when the new deadline is still ahead.
- Each clock has `dueAt` and `warnAt` (`warnBeforePct` before the deadline, in working time), and
  `warnedAt` / `breachedAt` once the alarm has sent them.

What a chip shows at `now` (`slaDisplay`), first that applies:

| State      | When                                 | Chip                           |
| ---------- | ------------------------------------ | ------------------------------ |
| `OnTime`   | a reply (else resolution) is running | "Reply due in 3h 10m"          |
| `DueSoon`  | past its `warnAt`                    | "Reply due in 12m" (warning)   |
| `Breached` | past its `dueAt`                     | "Reply overdue by 1h" (danger) |
| `Paused`   | resolution paused, nothing due       | "Paused · waiting on customer" |
| `Met`      | resolved: the first response         | "First reply in 8m" (muted)    |

The chip counts down in wall time (the client ticks every 30 s); the deadline itself is in the
policy's hours, so a business-hours reply due Monday morning reads "due in 2d" on Saturday.

Business hours (`addWorkingTime`, `workingTimeBetween`) walk the zone's working windows day by day
with `Intl` offsets, so a DST change moves the window, not the target.

## 4. In the `CustomersObject` (`apps/backend/src/worker/objects/customers/sla.ts`)

- **`customer_issue_slas`** (synced to members: unresolved, or resolved within 30 days): `id` (the
  issue's id), `accountId`, `policyId`, the policy's `name` / `targets` / `hours` / `warnBeforePct`
  as of the issue's start, `state` (`SlaState` JSON), and `nextAlertAt` (indexed). Its own table,
  so the issue table stays the issue record's.
- **Hook:** every issue write ends in `issueWritten(before, after)` (`issues.ts`), which calls
  `slaIssueWritten`: a new issue takes its account's policy (none: no row; issues opened before SLAs
  get none) and is folded from what it already holds; a later write maps its change to SLA events
  (`eventsOf`: customer message, first / last team reply, status, priority) in the same transaction.
  A deleted issue drops its row. An alert more than an hour past when first computed (a late
  delivery, the demo seed) is recorded without notifying.
- **Alarm:** `customersDeadlines` adds the earliest `nextAlertAt`. Every alarm turn first runs
  `runSlaAlerts` (≤ 100 rows, one transaction): `dueAlerts` → `markAlerts`, notifications for open
  issues, and on a breach `requestCompute`, so the overdue signals open within about 2 minutes. No
  polling.
- **Notifications:** to the issue's assignee, else the account owner. `customer_members` gains a
  nullable `memberId` (carried by `customers.setMembers`; the notification row is keyed by org
  member; an object projected before that pulls the members once more). A new user effect
  `user.createCustomerNotification` (`reason` `sla_<reply|resolution>_<warning|breach>`; sender
  guard: the org's own customers object) writes the inbox row on the issue's
  thread channel (`targetedResourceType` `channel`, `resourceType` `customer_issue`) and pushes.
- **Signals:** templates `response_overdue` ("Customer waiting on a reply", high: an open issue's
  running reply-due clock past its deadline) and `resolution_overdue` ("Issue past its resolution
  target", medium: the running resolution clock past due; a paused one is not). Config
  `graceMinutes` (0–1440, default 0): overdue by at least that. +1 / +2 step when the most overdue
  issue is late by ≥ 2× / ≥ 4× its target for that priority. No required source, no backfill
  baseline; they skip Needs attention's coverage but not churn or the rule's scope. Compute reads
  `customer_issue_slas` joined to the open issues (`AccountFacts.openIssueSlas`, one query per
  chunk); the alarm's breach requests a compute, and an answered or closed issue auto-resolves the
  signal on the next one. Evidence `overdue`: clock, overdue count, the most overdue issue (id,
  title, due instant) and how late ("2 issues waiting on a reply; the most overdue by 1h 20m").
  Seeded for new orgs and by migration `0023_customer_slas` for existing ones.
- **Reports** (`customers.support.report`, range, any member; `supportReport` in the domain): for
  issues opened in the range, median and p90 first response and resolution (working time), % within
  SLA per clock, breaches (late or overdue), overdue now, by account, by policy and by day.

### Client

- `src/customers/sla.ts` + `ui/sla-chip.ts`: the chip (`slaDisplay`), ticking on `shared.nowMs`.
- Support inbox: an SLA column, "· N overdue" in the header, an Overdue filter; overdue issues sort
  first among waiting on us. Thread control: the chip beside status and assignee.
- Customer page: a Support card (open, overdue, median first response and % within over 30 days).
- Overview: a Support row of four tiles (median / p90 first response, within SLA, breaches) linking
  to the **Support report** (`/customers/support`): tiles, first response by day, by account, by
  policy.
- Settings → **Support SLAs**: business hours and the ordered policies.
- Notifications inbox: "Reply overdue in #thread" / "Resolution due soon in #channel".

## 5. The issue record it reads (`issues.md`, session 4)

- `customer_issues`: `status` (`new | waiting_on_us | waiting_on_customer | on_hold | closed`),
  `priority` (`none | low | medium | high | urgent`; `none` gets medium's targets, `slaPriorityOf`),
  `assigneeUserId`, `accountId`, `threadChannelId`, `openedAt`, `firstTeamReplyAt`,
  `lastCustomerMessageAt`, `lastTeamReplyAt`, `closedAt`, `reopenCount`, `reopenedAt`.
- Asked of it: every write stays in `issues.ts`, ideally through one function the SLA hook wraps
  with `(before, after)` in the same transaction; demo seed issues to extend with SLA states.

## 6. Verification

- `sla.test.ts`: business hours (weekend carry-over, night start, end of summer time, multi-day,
  24/7, invalid hours), policy matching, the replay fixture, quantiles.
- `sla-replay.ts`: replays a script of wall times (`["2026-11-20 16:50", "open", "medium"]`,
  `["2026-11-23 09:20", "reply"]`, ...) with the alarm firing at each deadline the state asks for;
  the backend's object tests and the demo seed reuse it.
- `sla-policies.test.ts`: the default policy, admin-only CRUD and reorder, business hours, and that
  the migration seeds the same policy and rules as new orgs get.
- `sla-issues.test.ts`: the hook (policy, priorities, deletion), warnings and breaches notifying the
  owner's `UserObject` once each, stale alerts silent, the report RPC, and an overdue issue opening
  `response_overdue` that auto-resolves once answered.
- `evaluate.test.ts`: the two templates (grace, steps, coverage bypass, churn, scope).
- Web: chip states, inbox, thread control, report and overview stories, galleries (light, dark,
  mobile).

## 7. Open items

- Holidays in business hours.
- The report keeps its own range; the overview tiles do not carry theirs across.
- The customer page's inbox link opens the whole inbox (it has no account filter in the URL).
- An overdue signal's "how late" is as of the last compute (the chips are live).
