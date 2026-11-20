# Customers: support SLAs and response times

Targets for how fast the team answers and resolves a customer's support issue, live "due in 12m /
breached 1h ago" state on each issue, warnings before and at a breach, overdue signals in Needs
attention, and response-time reports. Builds on support issues (`support.md`, the issue record and
its statuses) and the author classifier (customer vs team messages).

Status: the clocks, business hours, policies and their settings RPCs are implemented. The issue
hook, alarm, notifications, signals, reports and UI land once the issue record does (§7).

## 1. Decisions

- **Hours per policy.** The org has one working week (`customer_settings.businessHours`: time zone,
  days, start and end; default Mon–Fri 09:00–17:00 UTC). Each policy counts either `business`
  hours or `always` (24/7). A customer writing Fri 16:50 with a 1 h target is due Mon 09:50 on
  business hours, Fri 17:50 on 24/7. No holidays yet.
- **Two clocks.** _Reply due_ and _resolution_ (below). A reopen, or the customer writing again
  after a team reply, starts a new reply-due clock with the first-response target: it shows live and
  warns, but only the first one counts as first response time in reports.
- **Resolution pauses** while the issue waits on the customer or is on hold.
- **SLA signals cover every customer.** `response_overdue` and `resolution_overdue` skip the org's
  Needs attention coverage (stages, required sources) but respect the rule's own scope: a Slack-only
  free customer waiting four hours still shows.
- **Reports:** four tiles on the Customers overview, linking to a Support report page.

## 2. Policies

`customer_sla_policies` (store `customers`, synced to members, soft delete):

| Column          | What                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `name`          | e.g. Standard, Enterprise                                                                              |
| `position`      | The order; first match wins                                                                            |
| `enabled`       |                                                                                                        |
| `appliesTo`     | `accountIds`, `planNames`, `tagsAny`; all empty = a default policy                                     |
| `targets`       | Per issue priority (`urgent`, `high`, `medium`, `low`; `none` uses `medium`): `firstResponseMinutes`, `resolutionMinutes` |
| `hours`         | `business` or `always`                                                                                 |
| `warnBeforePct` | Warn this share of the target before it is due (default 25%; 0 = only at breach)                       |

An account's policy (`policyFor`): the first enabled policy naming it by id, else the first naming
its plan or one of its tags, else the first default one; none = no SLA. Every org starts with
**Standard** (business hours, any account): urgent 1 h / 8 h, high 2 h / 16 h, medium 4 h / 24 h,
low 8 h / 40 h (first response / resolution, working time). Existing orgs get it from migration
`0022_customer_sla_policies`.

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

| State      | When                                   | Chip                            |
| ---------- | -------------------------------------- | ------------------------------- |
| `OnTime`   | a reply (else resolution) is running   | "Reply due in 3h 10m"           |
| `DueSoon`  | past its `warnAt`                      | "Reply due in 12m" (warning)    |
| `Breached` | past its `dueAt`                       | "Reply overdue by 1h" (danger)  |
| `Paused`   | resolution paused, nothing due         | "Paused · waiting on customer"  |
| `Met`      | resolved: the first response           | "First reply in 8m" (muted)     |

The chip counts down in wall time (the client ticks every 30 s); the deadline itself is in the
policy's hours, so a business-hours reply due Monday morning reads "due in 2d" on Saturday.

Business hours (`addWorkingTime`, `workingTimeBetween`) walk the zone's working windows day by day
with `Intl` offsets, so a DST change moves the window, not the target.

## 4. In the `CustomersObject` (lands with the issue record)

- **`customer_issue_slas`** (synced): `issueId` (PK), `accountId`, `policyId`, the policy's
  `targets` / `hours` / `warnBeforePct` as of the issue's start, `state` (`SlaState` JSON), and
  `nextAlertAt` (indexed). Its own table, so the issue table stays session 4's.
- **Hook:** every issue write goes through one function (`writeIssue(before, after)`), which maps
  the change to SLA events and folds them in the same transaction.
- **Alarm:** `customersDeadlines` adds the earliest `nextAlertAt`. Its turn takes the due rows,
  `dueAlerts` → `markAlerts`, sends the notifications, and re-evaluates the two SLA templates for
  those accounts only (not a full compute). No polling.
- **Notifications:** to the issue's assignee, else the account owner. `customer_members` gains a
  nullable `memberId` (carried by `customers.setMembers`; the notification row is keyed by org
  member). A new user effect `user.createCustomerNotification` (`reason` `sla_warning` /
  `sla_breach`; sender guard: the org's own customers object) writes the inbox row on the issue's
  thread channel (`targetedResourceType` `channel`, `resourceType` `customer_issue`) and pushes.
- **Signals:** templates `response_overdue` (an open issue past its reply-due deadline; +1 / +2
  step at 2× / 4× the target) and `resolution_overdue`, no required source, seeded for new orgs and
  by migration for existing ones. Evidence: overdue count, the oldest issue and how late.
- **Reports** (`customers.support.report`, range): median and p90 first response, median
  resolution, % within SLA per clock, breaches, by account and by policy.

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
  the migration seeds the same policy as new orgs get.

## 7. Remaining (stacked on the issue record)

Issue hook and `customer_issue_slas`, alarm turn, notifications, the two signal templates, the
report RPC, and UI: SLA settings page, chips on inbox rows and the thread control, the customer
page summary, overview tiles and the Support report.
