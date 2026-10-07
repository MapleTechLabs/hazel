import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import type { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"

/**
 * Root modal slot (legacy `atoms/modal-atoms` plus the global modals in `$orgSlug/layout.tsx`).
 * Stub: it records which modal is open; wave 2 turns each request into a modal Submodel.
 */

// MODEL

/** What a page or the shell asks for. One variant per legacy `useModal(...)` id. */
export const ModalRequest = Schema.Union([
	Schema.TaggedStruct("NewChannel", {}),
	Schema.TaggedStruct("CreateDm", {}),
	Schema.TaggedStruct("JoinChannel", {}),
	Schema.TaggedStruct("EmailInvite", {}),
	Schema.TaggedStruct("CreateOrganization", {}),
	Schema.TaggedStruct("CreateSection", {}),
	Schema.TaggedStruct("DeleteChannel", { channelId: ChannelId, channelName: Schema.String }),
	Schema.TaggedStruct("Feedback", {}),
	Schema.TaggedStruct("SetStatus", {}),
])
export type ModalRequest = typeof ModalRequest.Type

export const Model = Schema.NullOr(Schema.Struct({ request: ModalRequest }))
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	DismissedModal: {},
})
export type Message = typeof Message.Type

// INIT

export const init = (): Model => null

// UPDATE

export const open = (_model: Model, request: ModalRequest): Update.Return<Model, Message> => ({
	model: { request },
})

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
	Message.match<Update.Return<Model, Message>>(message, {
		DismissedModal: () => ({ model: null }),
	})

// VIEW

/** Renders nothing until wave 2 ports the modals. */
export const view = <ParentMessage>(h: HtmlBuilder<ParentMessage>, _model: Model): Html => h.empty
