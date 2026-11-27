// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The queue's rows per tab (today's `web-foldkit/src/page/customers/attention/rows.ts`) on W8's
 * `tableRow`: open signals (PK0's `queueRow`), account groups, the compact rows beside the preview,
 * snoozed and done. Each cell's key names its column in the tab's `columns`.
 */
import type { Content, Hazel } from "@hazel/ui/vocabulary/index"
import { formatDate, formatMoney, formatWeekdayTime } from "../data/format"
import { queueNameOf } from "../data/groups"
import { type AccountRow, type MemberRow, resolvedAtMsOf, type SignalRow } from "../data/queries"
import { environmentsHint, kindChip, NO_VALUE, severityChip } from "../ui/badges"
import { evidenceViz } from "../ui/evidence"
import { companyLogo, personAvatar, personLabel } from "../ui/identity"
import { planLine, queueRow } from "../ui/queue-row"
import { type AccountGroup, type AccountRun, ageText, personOf } from "./model"

export interface RowContext<Msg> {
	readonly nowMs: number
	readonly accountsById: ReadonlyMap<string, AccountRow>
	/** Each primary's environments (`environmentCounts`). */
	readonly environmentCounts: ReadonlyMap<string, number>
	readonly membersById: ReadonlyMap<string, MemberRow>
	readonly selectedId: string | null
	/** The selected row's inline actions (only it carries the menus' triggers). */
	readonly actions: ReadonlyArray<Hazel.NoTextInput<Msg>>
	readonly onPress: (signalId: SignalRow["id"]) => Msg
}

/** The row's account, named as the queue names it. */
const rowAccount = <Msg>(context: RowContext<Msg>, accountId: string): AccountRow | undefined => {
	const account = context.accountsById.get(accountId)
	return account === undefined ? undefined : { ...account, name: queueNameOf(account) }
}

/** A selectable row with the keyboard cursor; the selected one carries the actions. */
const rowShell = <Msg>(
	h: Hazel.H<Msg>,
	signal: SignalRow,
	account: AccountRow,
	context: RowContext<Msg>,
	cells: ReadonlyArray<Hazel.NoTextInput<Msg>>,
) => {
	const isSelected = signal.id === context.selectedId
	const row = h.tableRow
		.key(signal.id)
		.title(`${account.name}: ${signal.title}`)
		.current(isSelected)
		.selected(isSelected)
		.on("press", context.onPress(signal.id))
	return (isSelected && context.actions.length > 0 ? row.actions(...context.actions) : row).children(
		...cells,
	)
}

const cell = <Msg>(
	h: Hazel.H<Msg>,
	column: string,
	...content: ReadonlyArray<Hazel.NoTextInput<Msg> | null>
) => h.tableCell.column(column).children(...content)

/** The account: logo, name and plan line; a continuing row of the same account leaves it blank. */
const accountCell = <Msg>(h: Hazel.H<Msg>, account: AccountRow, run: AccountRun, context: RowContext<Msg>) =>
	// HAZEL-GAP(pk0-account-run): today a run of one account's rows joins their logos with a line.
	cell(
		h,
		"account",
		run.continuesAbove
			? null
			: h.stack
					.axis("horizontal")
					.density("compact")
					.align("center")
					.children(
						companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "sm" }),
						h.stack.density("none").children(
							h.text.strong().truncate().children(account.name),
							h.text
								.role("caption")
								.tone("muted")
								.numeric()
								.truncate()
								.children(planLine(account, context.environmentCounts.get(account.id))),
						),
					),
	)

// OPEN

export const SIGNAL_COLUMNS: ReadonlyArray<Content.TableColumn> = [
	{ key: "rank", label: "#", align: "end", width: "auto", sortable: true, optional: true },
	{ key: "account", label: "Account", width: "wide", sortable: true },
	{ key: "signal", label: "Signal and reason", width: "fill", sortable: true },
	{ key: "evidence", label: "Evidence", align: "end", width: "regular", optional: true },
	{ key: "severity", label: "Severity", width: "narrow", sortable: true },
	{ key: "age", label: "Age", align: "end", width: "auto", sortable: true, optional: true },
	{ key: "assignee", label: "", width: "auto", optional: true },
]

/** Open tab, one row per signal (PK0's `queueRow`). */
export const signalRow = <Msg>(
	h: Hazel.H<Msg>,
	signal: SignalRow,
	rank: number,
	context: RowContext<Msg>,
	run: AccountRun,
) => {
	const account = rowAccount(context, signal.accountId)
	if (account === undefined) return null
	const isSelected = signal.id === context.selectedId
	return queueRow(h, {
		id: signal.id,
		rank,
		account,
		signal,
		evidence: evidenceViz(h, signal.evidence),
		age: ageText(signal.openedAtMs, context.nowMs),
		assignee: personOf(context.membersById, signal.assigneeUserId),
		environmentCount: context.environmentCounts.get(account.id) ?? 0,
		isFocused: isSelected,
		isSelected,
		run,
		onPress: context.onPress(signal.id),
		actions: isSelected && context.actions.length > 0 ? context.actions : undefined,
	})
}

export const GROUP_COLUMNS: ReadonlyArray<Content.TableColumn> = [
	{ key: "rank", label: "#", align: "end", width: "auto", sortable: true, optional: true },
	{ key: "account", label: "Account", width: "wide", sortable: true },
	{ key: "signal", label: "Open signals", width: "fill" },
	{ key: "age", label: "Oldest", align: "end", width: "auto", sortable: true, optional: true },
	{ key: "assignee", label: "", width: "auto", optional: true },
]

/** One signal line inside an account group: severity, kind, title and reason, evidence. */
const groupLine = <Msg>(h: Hazel.H<Msg>, signal: SignalRow) =>
	h.stack
		.axis("horizontal")
		.density("compact")
		.align("center")
		.children(
			severityChip(h, signal.severity),
			signal.kind === "opportunity" ? kindChip(h, "opportunity") : null,
			h.text.strong().truncate().children(signal.title),
			h.text.role("caption").tone("muted").truncate().children(signal.reason),
			h.spacer,
			evidenceViz(h, signal.evidence),
		)

/** Open tab grouped by account: the account once, its signals stacked. */
export const accountGroupRow = <Msg>(
	h: Hazel.H<Msg>,
	group: AccountGroup,
	rank: number,
	context: RowContext<Msg>,
) => {
	const account = rowAccount(context, group.accountId)
	if (account === undefined) return null
	const oldest = Math.min(...group.signals.map((signal) => signal.openedAtMs))
	const assignees = [...new Set(group.signals.map((signal) => signal.assigneeUserId))]
	// One row per account, so no actions: the preview carries them.
	return rowShell(h, group.lead, account, { ...context, actions: [] }, [
		cell(h, "rank", h.text.tone("muted").numeric().children(String(rank))),
		cell(
			h,
			"account",
			h.stack
				.axis("horizontal")
				.density("compact")
				.align("center")
				.children(
					companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "sm" }),
					h.stack.density("none").children(
						h.stack
							.axis("horizontal")
							.density("tight")
							.align("center")
							.children(
								h.text.strong().truncate().children(account.name),
								group.signals.length > 1
									? h.badge.size("small").label(String(group.signals.length))
									: null,
							),
						h.text
							.role("caption")
							.tone("muted")
							.numeric()
							.truncate()
							.children(planLine(account, context.environmentCounts.get(account.id))),
					),
				),
		),
		cell(
			h,
			"signal",
			h.stack.density("snug").children(...group.signals.map((signal) => groupLine(h, signal))),
		),
		cell(h, "age", h.text.tone("muted").numeric().children(ageText(oldest, context.nowMs))),
		cell(
			h,
			"assignee",
			h.avatarStack.children(
				...assignees.map((userId) => personAvatar(h, personOf(context.membersById, userId))),
			),
		),
	])
}

// BESIDE THE PREVIEW

export const COMPACT_COLUMNS: ReadonlyArray<Content.TableColumn> = [
	{ key: "rank", label: "#", align: "end", width: "auto" },
	{ key: "signal", label: "Signal", width: "fill" },
	{ key: "age", label: "Age", align: "end", width: "auto" },
]

/** Open tab beside the preview: rank, the account's line over the signal's, age. */
export const compactRow = <Msg>(
	h: Hazel.H<Msg>,
	signal: SignalRow,
	rank: number,
	context: RowContext<Msg>,
	run: AccountRun,
) => {
	const account = rowAccount(context, signal.accountId)
	if (account === undefined) return null
	return rowShell(h, signal, account, { ...context, actions: [] }, [
		cell(h, "rank", h.text.tone("muted").numeric().children(String(rank))),
		cell(
			h,
			"signal",
			h.stack
				.axis("horizontal")
				.density("compact")
				.align("center")
				.children(
					run.continuesAbove
						? null
						: companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "sm" }),
					h.stack.density("none").children(
						run.continuesAbove
							? null
							: h.stack
									.axis("horizontal")
									.density("compact")
									.align("center")
									.children(
										h.text.strong().truncate().children(account.name),
										environmentsHint(h, context.environmentCounts.get(account.id) ?? 0),
										h.text
											.role("caption")
											.tone("muted")
											.numeric()
											.children(
												`${formatMoney(account.mrrMinor, account.currency)}/mo`,
											),
									),
						h.stack
							.axis("horizontal")
							.density("tight")
							.align("center")
							.children(
								severityChip(h, signal.severity),
								h.text.role("caption").strong().truncate().children(signal.title),
								h.text.role("caption").tone("muted").truncate().children(signal.reason),
							),
					),
				),
		),
		cell(h, "age", h.text.tone("muted").numeric().children(ageText(signal.openedAtMs, context.nowMs))),
	])
}

// SNOOZED

export const SNOOZED_COLUMNS: ReadonlyArray<Content.TableColumn> = [
	{ key: "account", label: "Account", width: "wide" },
	{ key: "signal", label: "Signal and snooze note", width: "fill" },
	{ key: "wakes", label: "Wakes up", width: "regular" },
	{ key: "snoozedBy", label: "Snoozed by", width: "regular", optional: true },
]

/** Snoozed tab: signal and snooze note, wake time ("Returning now" once due), who snoozed it. */
export const snoozedRow = <Msg>(
	h: Hazel.H<Msg>,
	signal: SignalRow,
	context: RowContext<Msg>,
	run: AccountRun,
) => {
	const account = rowAccount(context, signal.accountId)
	if (account === undefined) return null
	const untilMs = signal.snoozedUntilMs
	const isDue = untilMs !== null && untilMs <= context.nowMs
	const now = new Date(context.nowMs)
	return rowShell(h, signal, account, context, [
		accountCell(h, account, run, context),
		cell(
			h,
			"signal",
			h.stack.density("none").children(
				h.stack
					.axis("horizontal")
					.density("compact")
					.align("center")
					.children(
						severityChip(h, signal.severity),
						h.text.strong().truncate().children(signal.title),
					),
				h.text
					.role("caption")
					.tone("muted")
					.truncate()
					.children(
						signal.snoozeNote === null ? `No note · ${signal.reason}` : `“${signal.snoozeNote}”`,
					),
			),
		),
		cell(
			h,
			"wakes",
			h.stack
				.axis("horizontal")
				.density("compact")
				.align("start")
				.children(
					h.icon.name("clock"),
					h.stack.density("none").children(
						h.text
							.strong()
							.tone(isDue ? "warning" : "default")
							.children(
								isDue
									? "Returning now"
									: untilMs === null
										? NO_VALUE
										: formatWeekdayTime(new Date(untilMs)),
							),
						h.text
							.role("caption")
							.tone("muted")
							.children(untilMs === null ? "" : formatDate(new Date(untilMs), { now })),
					),
				),
		),
		cell(
			h,
			"snoozedBy",
			h.stack.density("none").children(
				personLabel(h, personOf(context.membersById, signal.snoozedByUserId)),
				signal.snoozedAtMs === null
					? null
					: h.text
							.role("caption")
							.tone("muted")
							.children(`on ${formatDate(new Date(signal.snoozedAtMs), { now })}`),
			),
		),
	])
}

// DONE

export const DONE_COLUMNS: ReadonlyArray<Content.TableColumn> = [
	{ key: "account", label: "Account", width: "wide" },
	{ key: "signal", label: "Signal and resolution", width: "fill" },
	{ key: "outcome", label: "Outcome", width: "narrow" },
	{ key: "resolvedBy", label: "Resolved by", width: "regular", optional: true },
	{ key: "openFor", label: "Open for", align: "end", width: "auto", optional: true },
	{ key: "resolved", label: "Resolved", align: "end", width: "auto" },
]

const OUTCOME_LABEL = {
	contacted: "Contacted",
	fixed: "Fixed",
	not_an_issue: "Not an issue",
	other: "Other",
} as const

const outcomeBadge = <Msg>(h: Hazel.H<Msg>, signal: SignalRow) =>
	signal.status === "auto_resolved"
		? h.badge.tone("info").label("Auto-resolved")
		: signal.status === "dismissed"
			? h.badge.style("quietOutline").label("Dismissed")
			: signal.outcome === "fixed"
				? h.badge.tone("success").label("Fixed")
				: h.badge.label(OUTCOME_LABEL[signal.outcome ?? "other"])

/** The reasons the server writes as codes; anything else is a person's own words. */
const NOT_USEFUL = "Dismissed as not useful"
const DISMISS_NOTE = new Map([
	["not_useful", NOT_USEFUL],
	["baseline", "Dismissed as a baseline: it already held when the rule was set up"],
])

const dismissNoteOf = (reason: string | null): string =>
	reason === null ? NOT_USEFUL : (DISMISS_NOTE.get(reason) ?? `Dismissed: ${reason}`)

/** Done tab: resolution, outcome, who resolved it (Hazel when it cleared on its own), how long it was open. */
export const doneRow = <Msg>(
	h: Hazel.H<Msg>,
	signal: SignalRow,
	context: RowContext<Msg>,
	run: AccountRun,
) => {
	const account = rowAccount(context, signal.accountId)
	if (account === undefined) return null
	const resolvedMs = resolvedAtMsOf(signal) ?? context.nowMs
	const note =
		signal.status === "auto_resolved"
			? `Condition cleared · ${signal.reason}`
			: signal.status === "dismissed"
				? dismissNoteOf(signal.dismissReason)
				: signal.resolutionNote === null
					? signal.reason
					: `“${signal.resolutionNote}”`
	return rowShell(h, signal, account, context, [
		accountCell(h, account, run, context),
		cell(
			h,
			"signal",
			h.stack.density("none").children(
				// HAZEL-GAP(pk2-text-struck): today a resolved signal's title is struck through.
				h.stack
					.axis("horizontal")
					.density("compact")
					.align("center")
					.children(
						h.text.truncate().children(signal.title),
						signal.kind === "opportunity"
							? h.text.role("caption").tone("accent").children("Opportunity")
							: null,
					),
				h.text.role("caption").tone("muted").truncate().children(note),
			),
		),
		cell(h, "outcome", h.stack.axis("horizontal").children(outcomeBadge(h, signal))),
		cell(
			h,
			"resolvedBy",
			signal.status === "auto_resolved"
				? h.text.tone("muted").children("Hazel · on its own")
				: personLabel(h, personOf(context.membersById, signal.resolvedByUserId)),
		),
		cell(h, "openFor", h.text.tone("muted").numeric().children(ageText(signal.openedAtMs, resolvedMs))),
		cell(
			h,
			"resolved",
			h.text
				.tone("muted")
				.numeric()
				.children(formatDate(new Date(resolvedMs), { now: new Date(context.nowMs) })),
		),
	])
}
