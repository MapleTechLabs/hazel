import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import type { AccountRow, MemberRow, SignalRow } from "../../../customers/queries"
import { resolvedAtMsOf } from "../../../customers/queries"
import { formatDate, formatMoney, formatWeekdayTime } from "../../../customers/format"
import { healthBadge, healthDot, kindChip, severityGlyph } from "../../../customers/ui/badges"
import { evidenceViz } from "../../../customers/ui/evidence"
import { companyLogo, personAvatar, personLabel } from "../../../customers/ui/identity"
import { planLine, queueRow } from "../../../customers/ui/queue-row"
import { IconClock } from "../../../icons"
import { Message } from "./message"
import type { AccountGroup } from "./model"

/** The queue's rows per tab: open signals (the kit's `queueRow`), account groups, snoozed and done. */

export const rowIdOf = (signalId: string) => `attention-row-${signalId}`

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** `6h`, `2d`, `5m`: how long a signal has been open. */
export const ageText = (fromMs: number, nowMs: number): string => {
	const ms = Math.max(0, nowMs - fromMs)
	return ms < HOUR_MS
		? `${Math.floor(ms / 60_000)}m`
		: ms < DAY_MS
			? `${Math.floor(ms / HOUR_MS)}h`
			: `${Math.floor(ms / DAY_MS)}d`
}

export interface RowContext {
	readonly nowMs: number
	readonly accountsById: ReadonlyMap<string, AccountRow>
	readonly membersById: ReadonlyMap<string, MemberRow>
	readonly selectedId: string | null
	/** The inline actions for the selected row (only it has the menus' triggers). */
	readonly actions: ReadonlyArray<Html>
}

const personOf = (context: RowContext, userId: string | null) => {
	const member = userId === null ? undefined : context.membersById.get(userId)
	return member === undefined ? null : { name: member.name, avatarUrl: member.avatarUrl }
}

const accountCell = <M>(h: HtmlBuilder<M>, account: AccountRow, className = "w-52"): Html =>
	h.div(
		[h.Role("cell"), h.Class(twMerge("flex shrink-0 items-center gap-3", className))],
		[
			companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "sm" }),
			h.div(
				[h.Class("flex min-w-0 flex-col")],
				[
					h.span([h.Class("truncate font-medium text-fg text-sm")], [account.name]),
					h.span([h.Class("truncate text-muted-fg text-xs tabular-nums")], [planLine(account)]),
				],
			),
		],
	)

/** A row container like `queueRow`'s: selectable, with the keyboard cursor's left bar. */
const rowShell = (
	h: HtmlBuilder<Message>,
	signal: SignalRow,
	context: RowContext,
	cells: ReadonlyArray<Html>,
): Html => {
	const isSelected = signal.id === context.selectedId
	return h.keyed("div")(
		signal.id,
		[
			h.Id(rowIdOf(signal.id)),
			h.Role("row"),
			h.AriaSelected(isSelected),
			...(isSelected ? [h.DataAttribute("focused", "true")] : []),
			h.Class(
				twMerge(
					"group/queue relative flex min-h-16 cursor-pointer items-center gap-4 border-border border-t px-4 py-3 first:border-t-0",
					"transition-colors hover:bg-wash data-focused:bg-wash",
					"before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary before:opacity-0 data-focused:before:opacity-100",
				),
			),
			h.OnClick(Message.ClickedRow({ signalId: signal.id })),
		],
		[...cells],
	)
}

/** Open tab, one row per signal. */
export const signalRow = (
	h: HtmlBuilder<Message>,
	signal: SignalRow,
	rank: number,
	context: RowContext,
): Html => {
	const account = context.accountsById.get(signal.accountId)
	if (account === undefined) return h.empty
	const isSelected = signal.id === context.selectedId
	return queueRow(h, {
		id: rowIdOf(signal.id),
		rank,
		account,
		signal,
		evidence: evidenceViz(h, signal.evidence),
		age: ageText(signal.openedAtMs, context.nowMs),
		assignee: personOf(context, signal.assigneeUserId),
		health: { status: account.healthStatus, score: account.healthScore },
		isFocused: isSelected,
		isSelected,
		onPress: Message.ClickedRow({ signalId: signal.id }),
		actions: isSelected && context.actions.length > 0 ? context.actions : undefined,
	})
}

/** Open tab beside the preview (Wonder: Queue Selected With Preview): account, signal, age, health. */
export const compactRow = (
	h: HtmlBuilder<Message>,
	signal: SignalRow,
	rank: number,
	context: RowContext,
): Html => {
	const account = context.accountsById.get(signal.accountId)
	if (account === undefined) return h.empty
	return rowShell(h, signal, context, [
		h.span(
			[h.Role("cell"), h.Class("w-5 shrink-0 text-right text-muted-fg text-sm tabular-nums")],
			[String(rank)],
		),
		companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "sm" }),
		h.div(
			[h.Role("cell"), h.Class("flex min-w-0 flex-1 flex-col gap-0.5")],
			[
				h.span(
					[h.Class("flex min-w-0 items-baseline gap-2")],
					[
						h.span([h.Class("truncate font-medium text-fg text-sm")], [account.name]),
						h.span(
							[h.Class("shrink-0 text-muted-fg text-xs tabular-nums")],
							[`${formatMoney(account.mrrMinor, account.currency)}/mo`],
						),
					],
				),
				h.span(
					[h.Class("flex min-w-0 items-center gap-1.5 text-xs")],
					[
						severityGlyph(h, signal.severity),
						h.span([h.Class("shrink-0 font-medium text-fg")], [signal.title]),
						h.span([h.Class("truncate text-muted-fg")], [signal.reason]),
					],
				),
			],
		),
		h.span(
			[h.Role("cell"), h.Class("w-8 text-right text-muted-fg text-sm tabular-nums")],
			[ageText(signal.openedAtMs, context.nowMs)],
		),
		h.span(
			[h.Role("cell"), h.Class("w-12 shrink-0 text-right")],
			[healthDot(h, { status: account.healthStatus, score: account.healthScore })],
		),
	])
}

/** Open tab grouped by account: the account once, its signals stacked. */
export const accountGroupRow = (
	h: HtmlBuilder<Message>,
	group: AccountGroup,
	rank: number,
	context: RowContext,
): Html => {
	const { lead } = group
	const account = context.accountsById.get(group.accountId)
	if (account === undefined) return h.empty
	const oldest = Math.min(...group.signals.map((signal) => signal.openedAtMs))
	const assignees = [...new Set(group.signals.map((signal) => signal.assigneeUserId))]
	return rowShell(h, lead, context, [
		h.span(
			[h.Role("cell"), h.Class("w-5 shrink-0 text-right text-muted-fg text-sm tabular-nums")],
			[String(rank)],
		),
		h.div(
			[h.Role("cell"), h.Class("flex w-52 shrink-0 items-center gap-3")],
			[
				companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "sm" }),
				h.div(
					[h.Class("flex min-w-0 flex-col")],
					[
						h.span(
							[h.Class("flex items-center gap-1.5 truncate font-medium text-fg text-sm")],
							[
								account.name,
								...(group.signals.length > 1
									? [
											h.span(
												[
													h.Class(
														"rounded bg-secondary px-1 text-[11px] text-muted-fg tabular-nums",
													),
												],
												[String(group.signals.length)],
											),
										]
									: []),
							],
						),
						h.span([h.Class("truncate text-muted-fg text-xs tabular-nums")], [planLine(account)]),
					],
				),
			],
		),
		h.div(
			[h.Role("cell"), h.Class("flex min-w-0 flex-1 flex-col gap-1.5")],
			group.signals.map((signal) =>
				h.div(
					[h.Class("flex min-w-0 items-center gap-2 text-sm")],
					[
						severityGlyph(h, signal.severity),
						...(signal.kind === "opportunity"
							? [kindChip(h, "opportunity", { className: "py-0 text-[11px]/5" })]
							: []),
						h.span([h.Class("shrink-0 font-medium text-fg")], [signal.title]),
						h.span([h.Class("truncate text-muted-fg text-xs")], [signal.reason]),
						h.span(
							[h.Class("ml-auto shrink-0 max-lg:hidden")],
							[evidenceViz(h, signal.evidence)],
						),
					],
				),
			),
		),
		h.span(
			[h.Role("cell"), h.Class("w-8 text-right text-muted-fg text-sm tabular-nums")],
			[ageText(oldest, context.nowMs)],
		),
		h.span(
			[h.Role("cell"), h.Class("flex w-10 justify-center -space-x-1.5")],
			assignees.map((userId) => personAvatar(h, personOf(context, userId), { ring: true })),
		),
		h.div(
			[h.Role("cell"), h.Class("flex w-28 shrink-0 justify-end")],
			[healthBadge(h, { status: account.healthStatus, score: account.healthScore })],
		),
	])
}

/** When a snoozed signal comes back: "Returning now" once its time has passed. */
const wakeCell = (h: HtmlBuilder<Message>, signal: SignalRow, nowMs: number): Html => {
	const untilMs = signal.snoozedUntilMs
	const isDue = untilMs !== null && untilMs <= nowMs
	return h.div(
		[h.Role("cell"), h.Class("flex w-44 shrink-0 items-start gap-2")],
		[
			IconClock(h, { className: twMerge("mt-0.5 size-3.5", isDue ? "text-warning" : "text-muted-fg") }),
			h.div(
				[h.Class("flex flex-col")],
				[
					h.span(
						[h.Class(twMerge("font-medium text-sm", isDue ? "text-warning" : "text-fg"))],
						[
							isDue
								? "Returning now"
								: untilMs === null
									? "—"
									: formatWeekdayTime(new Date(untilMs)),
						],
					),
					h.span(
						[h.Class("text-muted-fg text-xs")],
						[untilMs === null ? "" : formatDate(new Date(untilMs), { now: new Date(nowMs) })],
					),
				],
			),
		],
	)
}

/** Snoozed tab: signal and snooze note, wake time, who snoozed it. */
export const snoozedRow = (h: HtmlBuilder<Message>, signal: SignalRow, context: RowContext): Html => {
	const account = context.accountsById.get(signal.accountId)
	if (account === undefined) return h.empty
	return rowShell(h, signal, context, [
		accountCell(h, account),
		h.div(
			[h.Role("cell"), h.Class("flex min-w-0 flex-1 flex-col gap-0.5")],
			[
				h.div(
					[h.Class("flex min-w-0 items-center gap-2")],
					[
						severityGlyph(h, signal.severity),
						h.span([h.Class("truncate font-medium text-fg text-sm")], [signal.title]),
					],
				),
				h.span(
					[h.Class("truncate text-muted-fg text-xs")],
					[signal.snoozeNote === null ? `No note · ${signal.reason}` : `“${signal.snoozeNote}”`],
				),
			],
		),
		wakeCell(h, signal, context.nowMs),
		h.div(
			[h.Role("cell"), h.Class("flex w-36 shrink-0 flex-col max-lg:hidden")],
			[
				personLabel(h, personOf(context, signal.snoozedByUserId)),
				...(signal.snoozedAtMs === null
					? []
					: [
							h.span(
								[h.Class("pl-8 text-muted-fg text-xs")],
								[
									`on ${formatDate(new Date(signal.snoozedAtMs), { now: new Date(context.nowMs) })}`,
								],
							),
						]),
			],
		),
		...(signal.id === context.selectedId ? context.actions : []),
		h.div(
			[h.Role("cell"), h.Class("flex w-28 shrink-0 justify-end")],
			[healthBadge(h, { status: account.healthStatus, score: account.healthScore })],
		),
	])
}

const OUTCOME_LABEL = {
	contacted: "Contacted",
	fixed: "Fixed",
	not_an_issue: "Not an issue",
	other: "Other",
} as const

const outcomeChip = (h: HtmlBuilder<Message>, signal: SignalRow): Html => {
	const [label, className] =
		signal.status === "auto_resolved"
			? ["Auto-resolved", "bg-info-subtle text-info-subtle-fg"]
			: signal.status === "dismissed"
				? ["Dismissed", "border border-dashed border-border text-muted-fg"]
				: signal.outcome === "fixed"
					? ["Fixed", "bg-success-subtle text-success-subtle-fg"]
					: [OUTCOME_LABEL[signal.outcome ?? "other"], "bg-secondary text-fg"]
	return h.span(
		[h.Class(twMerge("inline-flex rounded-md px-1.5 py-0.5 font-medium text-xs", className))],
		[label],
	)
}

/** Done tab: resolution, outcome, who resolved it (Hazel when it cleared on its own), how long it was open. */
export const doneRow = (h: HtmlBuilder<Message>, signal: SignalRow, context: RowContext): Html => {
	const account = context.accountsById.get(signal.accountId)
	if (account === undefined) return h.empty
	const resolvedMs = resolvedAtMsOf(signal) ?? context.nowMs
	const note =
		signal.status === "auto_resolved"
			? `Condition cleared · ${signal.reason}`
			: signal.status === "dismissed"
				? `Dismissed as not useful${signal.dismissReason ? `: ${signal.dismissReason}` : ""}`
				: signal.resolutionNote === null
					? signal.reason
					: `“${signal.resolutionNote}”`
	return rowShell(h, signal, context, [
		accountCell(h, account),
		h.div(
			[h.Role("cell"), h.Class("flex min-w-0 flex-1 flex-col gap-0.5")],
			[
				h.div(
					[h.Class("flex min-w-0 items-center gap-2")],
					[
						h.span(
							[h.Class("truncate text-fg text-sm line-through decoration-muted-fg/60")],
							[signal.title],
						),
						...(signal.kind === "opportunity"
							? [h.span([h.Class("text-info-subtle-fg text-xs")], ["Opportunity"])]
							: []),
					],
				),
				h.span([h.Class("truncate text-muted-fg text-xs")], [note]),
			],
		),
		h.div([h.Role("cell"), h.Class("w-28 shrink-0")], [outcomeChip(h, signal)]),
		h.div(
			[h.Role("cell"), h.Class("w-36 shrink-0 max-lg:hidden")],
			[
				signal.status === "auto_resolved"
					? h.span([h.Class("text-muted-fg text-sm")], ["Hazel · on its own"])
					: personLabel(h, personOf(context, signal.resolvedByUserId)),
			],
		),
		h.span(
			[h.Role("cell"), h.Class("w-16 text-right text-muted-fg text-sm tabular-nums")],
			[ageText(signal.openedAtMs, resolvedMs)],
		),
		h.span(
			[h.Role("cell"), h.Class("w-16 text-right text-muted-fg text-sm tabular-nums")],
			[formatDate(new Date(resolvedMs), { now: new Date(context.nowMs) })],
		),
		...(signal.id === context.selectedId ? context.actions : []),
	])
}

/** The preview's "Other open signals" entry. */
export const otherSignalRow = (h: HtmlBuilder<Message>, signal: SignalRow, context: RowContext): Html =>
	h.button(
		[
			h.Type("button"),
			h.OnClick(Message.ClickedRow({ signalId: signal.id })),
			h.Class(
				"flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-left outline-hidden hover:bg-wash focus-visible:ring-2 focus-visible:ring-ring/70",
			),
		],
		[
			severityGlyph(h, signal.severity),
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col")],
				[
					h.span([h.Class("truncate font-medium text-fg text-sm")], [signal.title]),
					h.span([h.Class("truncate text-muted-fg text-xs")], [signal.reason]),
				],
			),
			personAvatar(h, personOf(context, signal.assigneeUserId)),
		],
	)
