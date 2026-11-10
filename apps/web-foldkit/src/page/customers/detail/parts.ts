import type * as Customers from "@hazel/domain/customers"
import type { UserId } from "@hazel/schema"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import type { AccountRow, MemberRow } from "../../../customers/queries"
import type * as Menu from "../../../ui/menu"
import { view as menuView } from "../../../ui/menu-view"
import type { Message } from "./message"

/** What every tab reads besides the Model. */
export interface Context {
	readonly orgSlug: string
	readonly nowMs: number
	readonly userId: UserId | null
	readonly account: AccountRow
	/** `customers.account.detail`, once it answers. */
	readonly detail: Customers.AccountDetail | null
	readonly membersById: ReadonlyMap<string, MemberRow>
}

export const icon = { attributes: { "data-slot": "icon" } }

export const memberOf = (context: Context, id: UserId | null): MemberRow | null =>
	id === null ? null : (context.membersById.get(id) ?? null)

/** A bordered section with a title row. */
export const card = (
	h: HtmlBuilder<Message>,
	options: Readonly<{
		title: string
		count?: number
		aside?: Html
		className?: string
		bodyClassName?: string
	}>,
	children: ReadonlyArray<Html>,
): Html =>
	h.section(
		[h.Class(twMerge("flex min-w-0 flex-col rounded-xl border border-border bg-bg", options.className))],
		[
			h.header(
				[h.Class("flex items-center justify-between gap-4 px-4 pt-4 sm:px-5")],
				[
					h.h2(
						[h.Class("flex items-baseline gap-2 font-semibold text-base text-fg")],
						[
							options.title,
							...(options.count === undefined
								? []
								: [
										h.span(
											[h.Class("font-normal text-muted-fg text-sm tabular-nums")],
											[String(options.count)],
										),
									]),
						],
					),
					...(options.aside ? [options.aside] : []),
				],
			),
			h.div([h.Class(twMerge("flex flex-col p-4 sm:px-5", options.bodyClassName))], [...children]),
		],
	)

/** A text link-button in a card header (`View billing`, `All notes`). */
export const headerLink = (h: HtmlBuilder<Message>, label: string, onPress: Message): Html =>
	h.button(
		[
			h.Type("button"),
			h.OnClick(onPress),
			h.Class(
				"cursor-pointer rounded text-primary text-sm outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring/70",
			),
		],
		[label],
	)

export const menu = (
	h: HtmlBuilder<Message>,
	model: Menu.Model,
	options: Readonly<{
		entries: ReadonlyArray<Menu.Entry>
		trigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
		content: (key: string) => ReadonlyArray<Html | string>
		toMessage: (message: Menu.Message) => Message
		className?: string
	}>,
): Html =>
	h.submodel({
		slotId: model.id,
		model,
		view: menuView,
		viewInputs: {
			entries: options.entries,
			toTrigger: options.trigger,
			content: options.content,
			className: options.className,
		},
		toParentMessage: options.toMessage,
	})

/** A load-more / retry footer for a paged list. */
export const pageFooter = (
	h: HtmlBuilder<Message>,
	options: Readonly<{ status: string; hasMore: boolean; label: string; onMore: Message; summary?: string }>,
): Html | null =>
	options.status === "Idle" ||
	(!options.hasMore && options.status !== "Failed" && options.summary === undefined)
		? null
		: h.div(
				[h.Class("flex items-center justify-between gap-4 px-4 py-3 text-muted-fg text-sm sm:px-5")],
				[
					h.span(
						[],
						[options.status === "Failed" ? "Couldn't load more." : (options.summary ?? "")],
					),
					...(options.hasMore || options.status === "Failed"
						? [
								h.button(
									[
										h.Type("button"),
										h.Disabled(options.status === "Loading"),
										h.OnClick(options.onMore),
										h.Class(
											"cursor-pointer rounded-lg border border-border px-3 py-1.5 text-fg text-sm hover:bg-wash disabled:cursor-default disabled:opacity-60",
										),
									],
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
			[h.span([h.Class("block h-3 w-full animate-pulse rounded bg-secondary")])],
		),
	)
