import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import type { Placement } from "../ui/aria/position"
import * as Popover from "../ui/popover"

/**
 * Popovers opened from many triggers (author avatars). Only one is open at a time, so the page keeps
 * one kit Popover Model keyed by trigger; every other trigger renders a shared closed Model.
 */

const closedModels = new Map<string, Popover.Model>()
const closedModel = (key: string) => {
	let model = closedModels.get(key)
	if (model === undefined) closedModels.set(key, (model = Popover.init(key)))
	return model
}

export interface PopoverTriggerOptions<M> {
	readonly key: string
	readonly active: { readonly key: string; readonly popover: Popover.Model } | null
	readonly toMessage: (key: string, message: Popover.Message) => M
	readonly toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
	readonly toContent: () => ReadonlyArray<Html>
	readonly placement?: Placement
	readonly className?: string
}

export const popoverTrigger = <M>(h: HtmlBuilder<M>, options: PopoverTriggerOptions<M>): Html => {
	const model =
		options.active !== null && options.active.key === options.key
			? options.active.popover
			: closedModel(options.key)
	return h.submodel({
		slotId: `popover-${options.key}`,
		model,
		view: Popover.view,
		viewInputs: {
			toTrigger: options.toTrigger,
			toContent: () => (model.isOpen ? options.toContent() : []),
			placement: options.placement,
			className: options.className,
		},
		toParentMessage: (message: Popover.Message) => options.toMessage(options.key, message),
	})
}
