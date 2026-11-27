import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconChevronDown } from "../../icons"
import { ariaButton, button } from "../../ui/button"
import { kbd } from "./shortcuts"

/** The queue's list frame, column header and inline actions (the Support inbox draws them). */

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
export const queueColumnHeader = <M>(
	h: HtmlBuilder<M>,
	columns: ReadonlyArray<QueueColumn<M>>,
	/** Extra classes, e.g. a container query hiding it where the list's rows wrap. */
	className?: string,
): Html =>
	h.div(
		[
			h.Role("row"),
			h.Class(
				twMerge(
					// A phone's rows wrap into lines that no longer sit under these columns.
					"flex h-9 items-center gap-4 border-border border-b px-4 font-medium text-muted-fg text-xs max-md:hidden",
					className,
				),
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
