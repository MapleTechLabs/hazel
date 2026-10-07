import { Schema } from "effect"
import type { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"

/**
 * Root command palette (legacy `components/command-palette` and `atoms/command-palette-state`).
 * Stub: open state and the requested page; wave 2 ports the dialog and its six pages.
 */

// MODEL

export const Page = Schema.Literals([
	"home",
	"search",
	"join-channel",
	"create-channel",
	"status",
	"appearance",
])
export type Page = typeof Page.Type

export const Model = Schema.Struct({ isOpen: Schema.Boolean, page: Page })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	DismissedCommandPalette: {},
})
export type Message = typeof Message.Type

// INIT

export const init = (): Model => ({ isOpen: false, page: "home" })

// UPDATE

/** `openChannelsBrowser`, `openCommandPaletteHome` and `openSearch` in `$orgSlug/layout.tsx`. */
export const open = (model: Model, page: Page): Update.Return<Model, Message> => ({
	model: modifyFields(model, { isOpen: () => true, page: () => page }),
})

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
	Message.match<Update.Return<Model, Message>>(message, {
		DismissedCommandPalette: () => ({ model: modifyFields(model, { isOpen: () => false }) }),
	})

// VIEW

/** Renders nothing until wave 2 ports the palette. */
export const view = <ParentMessage>(h: HtmlBuilder<ParentMessage>, _model: Model): Html => h.empty
