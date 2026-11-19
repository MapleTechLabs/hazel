import type { HealthStatus, SignalKind, SignalSeverity } from "@hazel/domain/customers"
import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconChevronDown } from "../../icons"
import { ariaButton, button } from "../../ui/button"
import { formatMoney } from "../format"
import { environmentsHintOf } from "../groups"
import { healthBadge, kindChip, severityChip } from "./badges"
import { companyLogo, personAvatar } from "./identity"
import { kbd } from "./shortcuts"

/**
 * A row of the Needs-attention queue (Foundations › Queue Row Signal States): rank, account,
 * signal and its plain reason, evidence, severity, age, assignee, health. Hovering or focusing the
 * row swaps evidence…assignee for the inline actions. `focused` is the keyboard cursor (j/k).
 */

export type QueueRowOptions<M> = Readonly<{
	/** The row's DOM id (the page scrolls the keyboard cursor into view by it). */
	id: string
	rank: number
	account: Readonly<{
		name: string
		logoUrl: string | null
		planName: string | null
		mrrMinor: number
		currency: string
	}>
	signal: Readonly<{ kind: SignalKind; severity: SignalSeverity; title: string; reason: string }>
	/** `evidenceViz(h, signal.evidence)`. */
	evidence: Html
	/** `2d`, `6h`: since the signal opened. */
	age: string
	assignee: Readonly<{ name: string; avatarUrl?: string | null }> | null
	health: Readonly<{ status: HealthStatus; score: number | null }>
	isFocused?: boolean
	isSelected?: boolean
	/** The account's other signals in the rows next to this one (`accountMark`). */
	run?: AccountRunMark
	/** The customer's other environments: `+2 environments` beside the name. */
	environmentCount?: number
	/** A press on the row: select it (the side panel preview). */
	onPress?: M
	/** Shown in place of evidence…assignee on hover/focus: `queueAction`s and the `⋯` menu. */
	actions?: ReadonlyArray<Html>
	className?: string
}>

/** Whether the rows above and below are the same account's signals. */
export type AccountRunMark = Readonly<{ continuesAbove: boolean; continuesBelow: boolean }>

const NO_RUN: AccountRunMark = { continuesAbove: false, continuesBelow: false }

/**
 * A row's account logo, joined by a line to the same account's rows above and below; a row that
 * continues the account above draws only the line. Stretches over the row's `py-3` so the line meets
 * the next row's. A phone's wrapped rows go without the line.
 */
export const accountMark = <M>(
	h: HtmlBuilder<M>,
	account: Readonly<{ name: string; logoUrl: string | null }>,
	run: AccountRunMark = NO_RUN,
): Html => {
	const line = (isShown: boolean) =>
		h.span([h.Class(twMerge("w-px flex-1 max-md:hidden", isShown && "bg-border"))])
	return h.span(
		[
			h.Class(
				"-my-3 flex w-7 shrink-0 flex-col items-center self-stretch max-md:my-0 max-md:justify-center",
			),
		],
		run.continuesAbove
			? [line(true), ...(run.continuesBelow ? [] : [line(false)])]
			: [
					line(false),
					companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "sm" }),
					line(run.continuesBelow),
				],
	)
}

/** A continuing row's top border: the account's rows read as one block. */
export const RUN_CONTINUES_CLASS = "border-t-transparent"

/** `Growth · $2,150/mo`, `Trial · $0/mo`; a primary's `· +1 environment` after it. */
export const planLine = (account: QueueRowOptions<never>["account"], environmentCount = 0): string =>
	[
		`${account.planName ?? "No plan"} · ${formatMoney(account.mrrMinor, account.currency)}/mo`,
		environmentsHintOf(environmentCount),
	]
		.filter((part) => part !== null)
		.join(" · ")

export const queueRow = <M>(h: HtmlBuilder<M>, options: QueueRowOptions<M>): Html =>
	h.div(
		[
			h.Id(options.id),
			h.Role("row"),
			h.AriaSelected(options.isSelected ?? false),
			...(options.isFocused ? [h.DataAttribute("focused", "true")] : []),
			h.Class(
				twMerge(
					"group/queue relative flex min-h-16 items-center gap-4 border-border border-t px-4 py-3 first:border-t-0",
					// A phone: account and health on the first line, the signal under them.
					"max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-1.5",
					"transition-colors hover:bg-wash data-focused:bg-wash",
					"before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary before:opacity-0 data-focused:before:opacity-100",
					options.isSelected && "bg-primary-subtle/40 hover:bg-primary-subtle/50",
					options.onPress !== undefined && "cursor-pointer",
					options.run?.continuesAbove && RUN_CONTINUES_CLASS,
					options.className,
				),
			),
			...(options.onPress === undefined ? [] : [h.OnClick(options.onPress)]),
		],
		[
			h.span(
				[
					h.Role("cell"),
					h.Class("w-5 shrink-0 text-right text-muted-fg text-sm tabular-nums max-md:hidden"),
				],
				[String(options.rank)],
			),
			h.div(
				[
					h.Role("cell"),
					h.Class(
						"flex w-52 shrink-0 items-center gap-3 self-stretch max-md:w-auto max-md:min-w-0 max-md:flex-1 max-md:shrink",
					),
				],
				[
					accountMark(h, options.account, options.run),
					// A continuing row leaves the account to the row above.
					...(options.run?.continuesAbove
						? []
						: [
								h.div(
									[h.Class("flex min-w-0 flex-col")],
									[
										h.span(
											[h.Class("truncate font-medium text-fg text-sm")],
											[options.account.name],
										),
										h.span(
											[h.Class("truncate text-muted-fg text-xs tabular-nums")],
											[planLine(options.account, options.environmentCount)],
										),
									],
								),
							]),
				],
			),
			h.div(
				[
					h.Role("cell"),
					h.Class(
						"flex min-w-0 flex-1 flex-col gap-0.5 max-md:order-last max-md:basis-full max-md:pl-10",
					),
				],
				[
					h.div(
						[h.Class("flex min-w-0 items-center gap-2")],
						[
							kindChip(h, options.signal.kind, { className: "py-0 text-2xs/5" }),
							h.span([h.Class("truncate font-medium text-fg text-sm")], [options.signal.title]),
						],
					),
					h.span([h.Class("truncate text-muted-fg text-xs")], [options.signal.reason]),
				],
			),
			h.div(
				[
					h.Class(
						twMerge(
							"flex shrink-0 items-center gap-4 max-md:hidden",
							options.actions &&
								"group-focus-within/queue:hidden group-hover/queue:hidden group-data-focused/queue:hidden",
						),
					),
				],
				[
					h.div(
						[h.Role("cell"), h.Class("flex w-32 justify-end max-lg:hidden")],
						[options.evidence],
					),
					h.div([h.Role("cell"), h.Class("w-24")], [severityChip(h, options.signal.severity)]),
					h.span(
						[h.Role("cell"), h.Class("w-8 text-right text-muted-fg text-sm tabular-nums")],
						[options.age],
					),
					h.span(
						[h.Role("cell"), h.Class("flex w-6 justify-center")],
						[personAvatar(h, options.assignee)],
					),
				],
			),
			...(options.actions
				? [
						h.div(
							[
								h.Class(
									"hidden shrink-0 items-center gap-1.5 group-focus-within/queue:flex group-hover/queue:flex group-data-focused/queue:flex max-md:order-last max-md:basis-full max-md:flex-wrap max-md:pl-10",
								),
							],
							[...options.actions],
						),
					]
				: []),
			h.div(
				[h.Role("cell"), h.Class("flex w-28 shrink-0 justify-end max-md:w-auto")],
				[healthBadge(h, { status: options.health.status, score: options.health.score })],
			),
		],
	)

/** One column of `queueColumnHeader`: a sortable one carries its press and its current direction. */
export type QueueColumn<M> = Readonly<{
	label: string
	className: string
	sort?: Readonly<{ onPress: M; direction: "ascending" | "descending" | null }>
}>

/**
 * The queue's header row. A sortable label is a button; the sorted column's chevron sits in the
 * gap beside it (before a right-aligned label), so sorting never shifts the columns.
 */
export const queueColumnHeader = <M>(h: HtmlBuilder<M>, columns: ReadonlyArray<QueueColumn<M>>): Html =>
	h.div(
		[
			h.Role("row"),
			h.Class(
				// A phone's rows wrap into lines that no longer sit under these columns.
				"flex h-9 items-center gap-4 border-border border-b px-4 font-medium text-muted-fg text-xs max-md:hidden",
			),
		],
		columns.map(({ label, className, sort }) => {
			if (sort === undefined) return h.span([h.Role("columnheader"), h.Class(className)], [label])
			const { direction } = sort
			const isRight = className.split(" ").includes("text-right")
			return h.span(
				[
					h.Role("columnheader"),
					...(direction === null ? [] : [h.AriaSort(direction)]),
					h.Class(className),
				],
				[
					ariaButton(
						h,
						{
							className: twMerge(
								"relative cursor-pointer rounded outline-hidden hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/70",
								direction !== null && "text-fg",
							),
							onPress: sort.onPress,
						},
						[
							label,
							...(direction === null
								? []
								: [
										IconChevronDown(h, {
											className: twMerge(
												"absolute top-1/2 size-3 -translate-y-1/2",
												isRight ? "right-full mr-0.5" : "left-full ml-0.5",
												direction === "ascending" && "rotate-180",
											),
										}),
									]),
						],
					),
				],
			)
		}),
	)

/** The queue's container (`role="table"`, rows above). */
export const queueList = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ ariaLabel: string; className?: string }>,
	rows: ReadonlyArray<Html>,
): Html =>
	h.div(
		[
			h.Role("table"),
			h.AriaLabel(options.ariaLabel),
			h.Class(twMerge("overflow-hidden rounded-xl border border-border", options.className)),
		],
		[h.div([h.Role("rowgroup")], [...rows])],
	)

/** One inline row action: `[icon] Assign`. Pass a menu's trigger `attributes` and `overlay` to open it. */
export const queueAction = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		label: string
		icon?: Html
		onPress?: M
		/** An icon-only action (`⋯`) is named by `label`. */
		iconOnly?: boolean
		/** The action's queue key, shown after the label (`A`, `H`, `D`). */
		shortcut?: string
		attributes?: ReadonlyArray<Attribute<M> | ChildAttribute>
		overlay?: Html
	}>,
): Html =>
	button(
		h,
		{
			intent: options.iconOnly ? "plain" : "outline",
			size: options.iconOnly ? "sq-xs" : "xs",
			onPress: options.onPress,
			attributes: [
				...(options.iconOnly ? [h.AriaLabel(options.label)] : []),
				...(options.attributes ?? []),
			],
		},
		[
			...(options.icon ? [options.icon] : []),
			...(options.iconOnly ? [] : [options.label]),
			...(options.shortcut === undefined ? [] : [kbd(h, options.shortcut, "-mr-0.5 h-4 min-w-4")]),
			...(options.overlay ? [options.overlay] : []),
		],
	)
