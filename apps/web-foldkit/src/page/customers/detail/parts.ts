import type * as Customers from "@hazel/domain/customers"
import type { UserId } from "@hazel/schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import type { AccountRow, MemberRow } from "../../../customers/queries"
import { button } from "../../../ui/button"
import { copyButton as kitCopyButton } from "../../../ui/copy-button"
import { link } from "../../../ui/link"
import { skeleton } from "../../../ui/skeleton"
import { heading } from "../../../ui/heading"
import { Message } from "./message"

/** What every tab reads besides the Model. */
export interface Context {
	readonly orgSlug: string
	readonly nowMs: number
	readonly userId: UserId | null
	readonly account: AccountRow
	/** `customers.account.detail`, once it answers. */
	readonly detail: Customers.AccountDetail | null
	readonly membersById: ReadonlyMap<string, MemberRow>
	/** An admin or owner: may change the customer's feature flags. */
	readonly isAdmin: boolean
}

export const icon = { attributes: { "data-slot": "icon" } }

export const memberOf = (context: Context, id: UserId | null): MemberRow | null =>
	id === null ? null : (context.membersById.get(id) ?? null)

/**
 * An icon button that copies an identifier; `label` names it in the toast, and in the tooltip
 * unless `target` says which of many it copies.
 */
export const copyButton = (
	h: HtmlBuilder<Message>,
	text: string,
	label: string,
	options: Readonly<{ target?: string; className?: string }> = {},
): Html =>
	kitCopyButton(h, {
		intent: "plain",
		size: "sq-xs",
		label: `Copy ${options.target ?? label}`,
		className: twMerge("shrink-0", options.className),
		onPress: Message.PressedCopy({ text, label }),
	})

/** A text link-button in a card header (`View billing`, `All notes`). */
export const headerLink = (h: HtmlBuilder<Message>, label: string, onPress: Message): Html =>
	link(h, { onPress, className: "cursor-pointer rounded-sm text-primary text-sm hover:underline" }, [label])

/** A load-more / retry footer for a paged list. */
export const pageFooter = (
	h: HtmlBuilder<Message>,
	options: Readonly<{
		status: string
		hasMore: boolean
		label: string
		onMore: Message
		summary?: string
		/** Nothing loaded yet: a failure is the first page's, not "more". */
		isEmpty: boolean
		/** The first page's failure, e.g. `Couldn't load invoices.` */
		failure: string
	}>,
): Html | null =>
	options.status === "Idle" ||
	(!options.hasMore && options.status !== "Failed" && options.summary === undefined)
		? null
		: h.div(
				[h.Class("flex items-center justify-between gap-4 px-4 py-3 text-muted-fg text-sm sm:px-5")],
				[
					h.span(
						[],
						[
							options.status === "Failed"
								? options.isEmpty
									? options.failure
									: "Couldn't load more."
								: (options.summary ?? ""),
						],
					),
					...(options.hasMore || options.status === "Failed"
						? [
								button(
									h,
									{
										intent: "outline",
										size: "sm",
										isDisabled: options.status === "Loading",
										onPress: options.onMore,
									},
									[
										options.status === "Loading"
											? "Loading…"
											: options.status === "Failed"
												? "Try again"
												: options.label,
									],
								),
							]
						: []),
				],
			)

/** Skeleton rows while a list's first page loads. */
export const skeletonRows = (h: HtmlBuilder<Message>, count: number): ReadonlyArray<Html> =>
	Array.from({ length: count }, (_, index) =>
		h.div(
			[h.Key(`skeleton-${index}`), h.AriaHidden(true), h.Class("flex h-12 items-center px-4 sm:px-5")],
			[skeleton(h, "h-3 w-full rounded")],
		),
	)

/** One row of a sidebar section: a label and its value. */
export const property = (h: HtmlBuilder<Message>, label: string, value: Html | string) =>
	h.div(
		[h.Class("grid min-h-8 grid-cols-[7rem_1fr] items-center gap-2 text-sm")],
		[h.span([h.Class("text-muted-fg")], [label]), h.div([h.Class("min-w-0 text-fg")], [value])],
	)

export const sidebarSection = (
	h: HtmlBuilder<Message>,
	title: string,
	aside: string | null,
	children: ReadonlyArray<Html>,
) =>
	h.section(
		[h.Class("flex flex-col border-border border-b px-5 py-4 last:border-b-0 max-md:px-4")],
		[
			h.div(
				[h.Class("flex items-center justify-between pb-2")],
				[
					heading(h, { variant: "subsection", level: 2 }, [title]),
					...(aside === null ? [] : [h.span([h.Class("text-muted-fg text-xs")], [aside])]),
				],
			),
			...children,
		],
	)
