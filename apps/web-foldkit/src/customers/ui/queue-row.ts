import type { HealthStatus, SignalKind, SignalSeverity } from "@hazel/domain/customers"
import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { button } from "../../ui/button"
import { formatMoney } from "../format"
import { healthBadge, kindChip, severityChip } from "./badges"
import { companyLogo, personAvatar } from "./identity"

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
	/** A press on the row: select it (the side panel preview). */
	onPress?: M
	/** Shown in place of evidence…assignee on hover/focus: `queueAction`s and the `⋯` menu. */
	actions?: ReadonlyArray<Html>
	className?: string
}>

/** `Growth · $2,150/mo`, `Trial · $0/mo`. */
export const planLine = (account: QueueRowOptions<never>["account"]): string =>
	`${account.planName ?? "No plan"} · ${formatMoney(account.mrrMinor, account.currency)}/mo`

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
						"flex w-52 shrink-0 items-center gap-3 max-md:w-auto max-md:min-w-0 max-md:flex-1 max-md:shrink",
					),
				],
				[
					companyLogo(h, {
						name: options.account.name,
						logoUrl: options.account.logoUrl,
						size: "sm",
					}),
					h.div(
						[h.Class("flex min-w-0 flex-col")],
						[
							h.span([h.Class("truncate font-medium text-fg text-sm")], [options.account.name]),
							h.span(
								[h.Class("truncate text-muted-fg text-xs tabular-nums")],
								[planLine(options.account)],
							),
						],
					),
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
							kindChip(h, options.signal.kind, { className: "py-0 text-[11px]/5" }),
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
			...(options.overlay ? [options.overlay] : []),
		],
	)
