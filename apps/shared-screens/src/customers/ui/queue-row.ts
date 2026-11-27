// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The Needs-attention queue (today's `web-foldkit/src/customers/ui/queue-row.ts`) on W8's `table`:
 * rank, account, signal and its reason, evidence, severity, age, assignee. Hovering, focusing or the
 * j/k row shows the inline actions; `current` is the keyboard row.
 */
import type { SignalKind, SignalSeverity } from "@hazel/domain/customers"
import type { Content, Hazel, IconName } from "@hazel/ui/vocabulary/index"
import { formatMoney } from "../data/format"
import { environmentsHintOf } from "../data/groups"
import { kindChip, severityChip } from "./badges"
import { companyLogo, type Person, personAvatar } from "./identity"

export type QueueAccount = Readonly<{
	name: string
	logoUrl: string | null
	planName: string | null
	mrrMinor: number
	currency: string
}>

/** Whether the rows above and below are the same account's signals. */
export type AccountRunMark = Readonly<{ continuesAbove: boolean; continuesBelow: boolean }>

/** The queue's columns; `evidence` drops on the compact size class, as today's phone rows. */
export const QUEUE_COLUMNS: ReadonlyArray<Content.TableColumn> = [
	// HAZEL-GAP(table-column-widths): today's rank is `w-5`, the account `w-52`, age `w-8` and the assignee `w-6`; the table has `narrow` (w-24), `regular` (w-32) and `wide` (w-44).
	{ key: "rank", label: "#", align: "end", width: "auto", optional: true },
	{ key: "account", label: "Account", width: "wide" },
	{ key: "signal", label: "Signal", width: "fill" },
	{ key: "evidence", label: "Evidence", align: "end", width: "regular", optional: true },
	{ key: "severity", label: "Severity", width: "narrow", sortable: true },
	{ key: "age", label: "Age", align: "end", width: "auto", sortable: true, optional: true },
	{ key: "assignee", label: "Owner", width: "auto", optional: true },
]

/** `Growth · $2,150/mo`, `Trial · $0/mo`; a primary's `· +1 environment` after it. */
export const planLine = (account: QueueAccount, environmentCount = 0): string =>
	[
		`${account.planName ?? "No plan"} · ${formatMoney(account.mrrMinor, account.currency)}/mo`,
		environmentsHintOf(environmentCount),
	]
		.filter((part) => part !== null)
		.join(" · ")

/** The queue: W8's table over `queueRow`s; `sort` marks a sortable header, `onSort` reports a press. */
export const queueTable = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{
		label: string
		/** The page's own headers (today's `queueColumnHeader` cells); keys stay the row's cell keys. */
		columns?: ReadonlyArray<Content.TableColumn>
		sort?: Content.TableSort
		onSort?: (column: string) => Msg
		loading?: boolean
	}>,
	rows: ReadonlyArray<Hazel.NoTextInput<Msg>>,
) => {
	// HAZEL-GAP(table-frame): today's queue sits in a rounded bordered box (`rounded-xl border`); the table has no frame, so the page wraps it in a `frame`.
	const table = h.table
		.label(options.label)
		.columns(options.columns ?? QUEUE_COLUMNS)
		.sort(options.sort)
		.loading(options.loading ?? false)
	const onSort = options.onSort
	return (onSort === undefined ? table : table.on("sort", ({ column }) => onSort(column))).children(...rows)
}

export type QueueRowOptions<Msg> = Readonly<{
	/** The row's key (the page scrolls the keyboard row into view by it). */
	id: string
	rank: number
	account: QueueAccount
	signal: Readonly<{ kind: SignalKind; severity: SignalSeverity; title: string; reason: string }>
	/** `evidenceViz(h, signal.evidence)`. */
	evidence: Hazel.NoTextInput<Msg>
	/** `2d`, `6h`: since the signal opened. */
	age: string
	assignee: Person | null
	/** The keyboard row (j/k). */
	isFocused?: boolean
	isSelected?: boolean
	/** The account's other signals in the rows next to this one. */
	run?: AccountRunMark
	/** The customer's other environments: `+2 environments` in the plan line. */
	environmentCount?: number
	/** A press on the row: select it (the side panel preview). */
	onPress?: Msg
	/** Shown on hover, focus or while `isFocused`: `queueAction`s and the `⋯` menu. */
	actions?: ReadonlyArray<Hazel.NoTextInput<Msg>>
}>

const accountCell = <Msg>(h: Hazel.H<Msg>, options: QueueRowOptions<Msg>) =>
	// HAZEL-GAP(pk0-account-run): today a run of one account's rows joins their logos with a vertical line and drops the hairline between them; a continuing row here only leaves the account blank.
	options.run?.continuesAbove
		? null
		: h.stack
				.axis("horizontal")
				.density("compact")
				.align("center")
				.children(
					companyLogo(h, {
						name: options.account.name,
						logoUrl: options.account.logoUrl,
						size: "sm",
					}),
					h.stack
						.density("tight")
						.children(
							h.text.strong().truncate().children(options.account.name),
							h.text
								.role("caption")
								.tone("muted")
								.numeric()
								.truncate()
								.children(planLine(options.account, options.environmentCount)),
						),
				)

const signalCell = <Msg>(h: Hazel.H<Msg>, signal: QueueRowOptions<Msg>["signal"]) =>
	h.stack
		.density("tight")
		.children(
			h.stack
				.axis("horizontal")
				.density("compact")
				.align("center")
				.children(kindChip(h, signal.kind), h.text.strong().truncate().children(signal.title)),
			h.text.role("caption").tone("muted").truncate().children(signal.reason),
		)

export const queueRow = <Msg>(h: Hazel.H<Msg>, options: QueueRowOptions<Msg>) => {
	const cell = (column: string, ...content: ReadonlyArray<Hazel.NoTextInput<Msg>>) =>
		h.tableCell.column(column).children(...content)
	const row = h.tableRow
		.key(options.id)
		.title(`${options.account.name}: ${options.signal.title}`)
		.current(options.isFocused ?? false)
		.selected(options.isSelected ?? false)
	// HAZEL-GAP(pk0-queue-actions-swap): today the actions replace evidence to assignee on hover; the table draws them over the last cell.
	const withActions = options.actions === undefined ? row : row.actions(...options.actions)
	return (options.onPress === undefined ? withActions : withActions.on("press", options.onPress)).children(
		cell("rank", h.text.tone("muted").numeric().children(String(options.rank))),
		cell("account", accountCell(h, options)),
		cell("signal", signalCell(h, options.signal)),
		cell("evidence", options.evidence),
		// A horizontal stack keeps the chip at its own width (a cell stretches its child).
		cell("severity", h.stack.axis("horizontal").children(severityChip(h, options.signal.severity))),
		cell("age", h.text.tone("muted").numeric().children(options.age)),
		cell("assignee", personAvatar(h, options.assignee)),
	)
}

/** One inline row action: `[icon] Assign`, or an icon-only one (`⋯`) named by `label`. */
export const queueAction = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{
		label: string
		icon?: IconName
		onPress?: Msg
		iconOnly?: boolean
		shortcut?: string
	}>,
) => {
	// HAZEL-GAP(pk0-action-shortcut): today an action shows its queue key after the label (`A`, `H`, `D`) as a key cap; `button` has no shortcut.
	const button = h.button
		.label(options.label)
		.icon(options.icon)
		.variant(options.iconOnly ? "ghost" : "outline")
		.size("xsmall")
		.iconOnly(options.iconOnly ?? false)
	return options.onPress === undefined ? button : button.on("press", options.onPress)
}
