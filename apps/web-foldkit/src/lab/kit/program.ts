import type { Html, HtmlBuilder } from "foldkit/html"
import * as Toaster from "../../overlay/toaster"
import { labPage } from "../frame"
import { actions } from "./actions"
import { sectionNav } from "./chrome"
import { display } from "./display"
import { feedback } from "./feedback"
import { fields } from "./fields"
import { foundations } from "./foundations"
import { init, Message, Model } from "./model"
import { navigation } from "./navigation"
import { overlays } from "./overlays"
import { selection } from "./selection"
import { subscriptions, update } from "./update"

/**
 * The kit page as a program: `entries/kit.ts` boots it on `/lab/kit`, and `kit.gallery.ts` boots the
 * same one in a headless browser to screenshot it.
 */

/** The last thing a specimen reported, pinned to the corner. */
const eventLog = (h: HtmlBuilder<Message>, model: Model): Html =>
	h.output(
		[
			h.AriaLive("polite"),
			h.Class(
				model.lastEvent === ""
					? "sr-only"
					: "fixed bottom-4 left-4 z-40 max-w-xs truncate rounded-lg border border-fg/10 bg-overlay px-3 py-1.5 text-fg-3 text-xs shadow-md",
			),
		],
		[model.lastEvent],
	)

const view = (model: Model, h: HtmlBuilder<Message>): Html =>
	labPage(
		h,
		{
			title: "Kit",
			description:
				"Every src/ui component, live. Pages compose these; a missing variant is added here.",
			className: "max-w-7xl",
		},
		[
			h.div(
				[h.Class("flex items-start gap-10")],
				[
					sectionNav(h),
					h.div(
						[h.Class("flex min-w-0 flex-1 flex-col gap-20 pb-24")],
						[
							foundations(h),
							actions(h, model),
							fields(h, model),
							selection(h, model),
							navigation(h, model),
							feedback(h, model),
							overlays(h, model),
							display(h, model),
						],
					),
				],
			),
			eventLog(h, model),
			Toaster.view(h, model.toaster, (message) => Message.GotToasterMessage({ message }), false),
		],
	)

export const program = {
	Model,
	init: () => ({ model: init() }),
	update,
	view,
	subscriptions,
}
