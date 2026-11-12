import { Schema } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { type AppActionId, appKeymap, KEYMAP_CATEGORIES } from "~/lib/keybindings/app-keymap"
import { comboLabel, type Platform } from "~/lib/keybindings/key-combo"
import type { Shared } from "../../page/contract"
import { AppRoute } from "../../route"
import { button } from "../../ui/button"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { closed, completed } from "../out-message"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, Message as FrameMessage, frameView, initFrame, isCloseRequest, modalTitle } from "./frame"
import * as Requests from "./requests"

/** Discord's Mod+/ "Keyboard Combos": every shortcut on the user's keys, in the platform's notation. */

const Model = Schema.Struct({ frame: Frame })
type Model = typeof Model.Type

export const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ClickedClose: {},
	ClickedCustomize: { orgSlug: Schema.String },
})
type Message = typeof Message.Type

type Return = ModalReturn<Model, Message>

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) =>
			isCloseRequest(message) ? { model, outMessage: closed } : { model },
		ClickedClose: () => ({ model, outMessage: closed }),
		ClickedCustomize: ({ orgSlug }) => ({
			model,
			outMessage: completed({ route: AppRoute.MySettingsKeybinds({ orgSlug }) }),
		}),
	})

const keyCap = <M>(h: HtmlBuilder<M>, combo: string, platform: Platform): Html =>
	h.kbd(
		[
			h.Class(
				"inline-flex min-w-6 items-center justify-center rounded-md border border-border bg-secondary px-1.5 font-mono text-muted-fg text-xs/5",
			),
		],
		[comboLabel(combo, platform)],
	)

/** Aliases of the unread-channel steps until there is mention data: not listed twice. */
const UNLISTED: ReadonlySet<AppActionId> = new Set(["mention.previous", "mention.next"])

const shortcutRow = <M>(h: HtmlBuilder<M>, shared: Shared, id: AppActionId): Html => {
	const keys = appKeymap.keysOf(shared.keys, id)
	return h.li(
		[h.Class("flex items-center justify-between gap-4 py-1.5 text-sm")],
		[
			h.span([h.Class("text-fg")], [appKeymap.byId[id].label]),
			h.span(
				[h.Class("flex shrink-0 items-center gap-1")],
				keys.length === 0
					? [h.span([h.Class("text-muted-fg text-xs")], ["Not set"])]
					: keys.map((combo) => keyCap(h, combo, shared.keyboardPlatform)),
			),
		],
	)
}

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, { shared }, h) =>
	frameView(
		h,
		model.frame,
		{ size: "2xl" },
		() => [
			dialogHeader(h, {}, [modalTitle(h, model.frame, "Keyboard shortcuts")]),
			dialogBody(h, [
				h.div(
					[h.Class("grid gap-x-8 gap-y-6 sm:grid-cols-2")],
					KEYMAP_CATEGORIES.map((category) =>
						h.section(
							[h.AriaLabel(category)],
							[
								h.h3(
									[
										h.Class(
											"mb-1 font-medium text-muted-fg text-xs uppercase tracking-wide",
										),
									],
									[category],
								),
								h.ul(
									[h.Class("divide-y divide-border")],
									appKeymap.actions
										.filter(
											(action) =>
												action.category === category && !UNLISTED.has(action.id),
										)
										.map((action) => shortcutRow(h, shared, action.id)),
								),
							],
						),
					),
				),
			]),
			dialogFooter(h, [
				...(shared.orgSlug === null
					? []
					: [
							button(
								h,
								{
									intent: "plain",
									onPress: Message.ClickedCustomize({ orgSlug: shared.orgSlug }),
								},
								["Customize keybinds"],
							),
						]),
				button(h, { intent: "outline", onPress: Message.ClickedClose() }, ["Close"]),
			]),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)

export const modal = defineModal(
	"KeyboardShortcuts",
	{ request: Requests.KeyboardShortcuts, Model, Message },
	{
		init: () => ({ model: { frame: initFrame("keyboard-shortcuts") } }),
		update,
		view,
	},
)
