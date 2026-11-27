import type { Html, HtmlBuilder } from "foldkit/html"
import * as Modal from "../overlay/modal"
import * as Toasts from "../overlay/toaster"
import { type PageMessage, viewPage } from "../page/registry"
import { isNativeSectionRoute } from "../shell/sections"
import { Message } from "./message"
import { type Model, sharedOf } from "./model"

/**
 * The host draws its parts into fixed regions; the Effect UI shell moves each region into its
 * place in the frame (`src/root/foldkit.ts`). The list and order never change, so Foldkit only ever
 * patches inside a region and never inserts next to one it no longer holds.
 */
export const REGIONS = ["page", "overlays"] as const
export type Region = (typeof REGIONS)[number]

export const REGION_ATTRIBUTE = "data-foldkit-region"

// Module-level and built as literals: memoized views compare them by reference, and wrapper
// constructors would re-validate large payloads (message pages) per dispatch.
export const toPageMessage = (message: PageMessage): Message => ({ _tag: "GotPageMessage", message })
const toToastsMessage = (message: Toasts.Message): Message => ({ _tag: "GotToastsMessage", message })
const toModalMessage = (message: Modal.Message): Message => ({ _tag: "GotModalMessage", message })

/** The routed page, or an empty placeholder until its page is ported. */
const pageBody = (model: Model, h: HtmlBuilder<Message>, isInsideMain: boolean): Html => {
	if (model.page !== null) return viewPage(h, model.page, { shared: sharedOf(model) }, toPageMessage)
	const placeholder = h.Attribute("data-page-placeholder", model.context.route._tag)
	return isInsideMain ? h.div([placeholder]) : h.main([placeholder])
}

interface Regions {
	readonly page: ReadonlyArray<Html>
	readonly overlays: ReadonlyArray<Html>
}

const regionsOf = (model: Model, h: HtmlBuilder<Message>): Regions => ({
	// Settings, notifications, channel settings and customers draw their layout in the shell (`root/sections.ts`).
	page: [pageBody(model, h, isNativeSectionRoute(model.context.route))],
	overlays: [
		Toasts.view(h, model.toasts, toToastsMessage, model.context.isMobile),
		Modal.view(h, model.modal, sharedOf(model), toModalMessage),
	],
})

export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
	const regions = regionsOf(model, h)
	return h.div(
		[h.Attribute("data-foldkit-host", ""), h.Attribute("hidden", "")],
		REGIONS.map((region) =>
			h.keyed("div")(
				region,
				[h.Attribute(REGION_ATTRIBUTE, region), h.Class("contents")],
				[...regions[region]],
			),
		),
	)
}
