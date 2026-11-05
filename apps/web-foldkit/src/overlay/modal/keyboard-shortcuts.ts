import { Schema } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { SHORTCUT_SECTIONS, type Shortcut } from "~/lib/hotkeys/shortcut-catalog"
import { hotkeyLabel } from "../../shell/channels-sidebar/hotkey-label"
import { button } from "../../ui/button"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { closed } from "../out-message"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, Message as FrameMessage, frameView, initFrame, isCloseRequest, modalTitle } from "./frame"
import * as Requests from "./requests"

/** Discord's Mod+/ "Keyboard Combos": every shortcut, in the platform's notation. */

const Model = Schema.Struct({ frame: Frame })
type Model = typeof Model.Type

export const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ClickedClose: {},
})
type Message = typeof Message.Type

type Return = ModalReturn<Model, Message>

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) =>
			isCloseRequest(message) ? { model, outMessage: closed } : { model },
		ClickedClose: () => ({ model, outMessage: closed }),
	})

const keyCap = <M>(h: HtmlBuilder<M>, combo: string): Html =>
	h.kbd(
		[
			h.Class(
				"inline-flex min-w-6 items-center justify-center rounded-md border border-border bg-secondary px-1.5 font-mono text-muted-fg text-xs/5",
			),
		],
		[hotkeyLabel(combo)],
	)

const shortcutRow = <M>(h: HtmlBuilder<M>, shortcut: Shortcut): Html =>
	h.li(
		[h.Class("flex items-center justify-between gap-4 py-1.5 text-sm")],
		[
			h.span([h.Class("text-fg")], [shortcut.label]),
			h.span(
				[h.Class("flex shrink-0 items-center gap-1")],
				shortcut.keys.map((combo) => keyCap(h, combo)),
			),
		],
	)

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "2xl" },
		() => [
			dialogHeader(h, {}, [modalTitle(h, model.frame, "Keyboard shortcuts")]),
			dialogBody(h, [
				h.div(
					[h.Class("grid gap-x-8 gap-y-6 sm:grid-cols-2")],
					SHORTCUT_SECTIONS.map((section) =>
						h.section(
							[h.AriaLabel(section.title)],
							[
								h.h3(
									[
										h.Class(
											"mb-1 font-medium text-muted-fg text-xs uppercase tracking-wide",
										),
									],
									[section.title],
								),
								h.ul(
									[h.Class("divide-y divide-border")],
									section.shortcuts.map((shortcut) => shortcutRow(h, shortcut)),
								),
							],
						),
					),
				),
			]),
			dialogFooter(h, [button(h, { intent: "outline", onPress: Message.ClickedClose() }, ["Close"])]),
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
