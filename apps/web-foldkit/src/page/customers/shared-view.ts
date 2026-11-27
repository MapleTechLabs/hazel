import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import type * as Menu from "../../ui/menu"
import { view as menuView } from "../../ui/menu-view"

/** View pieces every Customers page draws the same way. */

/** A page's menu: the kit's menu as a submodel slot, its Messages mapped into the page's. */
export const menu = <M>(
	h: HtmlBuilder<M>,
	model: Menu.Model,
	options: Readonly<{
		entries: ReadonlyArray<Menu.Entry>
		trigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
		content: (key: string) => ReadonlyArray<Html | string>
		toMessage: (message: Menu.Message) => M
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

/** One figure: a small muted label over the value, a quieter detail under it. */
export const stat = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ label: string; value: Html | string; detail?: string | null; className?: string }>,
): Html =>
	h.div(
		[h.Class(twMerge("flex min-w-0 flex-col gap-0.5", options.className))],
		[
			h.span([h.Class("text-muted-fg text-xs")], [options.label]),
			typeof options.value === "string"
				? h.span(
						[
							h.Class("truncate font-medium text-fg text-sm tabular-nums"),
							h.Title(options.value),
						],
						[options.value],
					)
				: options.value,
			...(options.detail === undefined || options.detail === null
				? []
				: [
						h.span(
							[h.Class("truncate text-muted-fg text-xs tabular-nums"), h.Title(options.detail)],
							[options.detail],
						),
					]),
		],
	)
