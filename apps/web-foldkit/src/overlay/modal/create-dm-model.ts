import { ChannelId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { ToastRequest } from "../toasts"
import { OrgUser } from "./create-dm-data"
import { Frame, Message as FrameMessage } from "./frame"

/** The create DM modal's state: search, selection and the org's users. */

export const Model = Schema.Struct({
	frame: Frame,
	searchQuery: Schema.String,
	isSearchFocused: Schema.Boolean,
	selectedUserIds: Schema.Array(UserId),
	organizationUsers: Schema.Array(OrgUser),
	isSubmitting: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ChangedSearch: { value: Schema.String },
	FocusedSearch: {},
	BlurredSearch: {},
	ClickedUser: { userId: UserId },
	ClickedCancel: {},
	ClickedStartConversation: {},
	UpdatedOrganizationUsers: { users: Schema.Array(OrgUser) },
	FoundExistingDm: { channelId: ChannelId },
	SucceededCreateDm: { channelId: ChannelId },
	FailedCreateDm: { toast: ToastRequest },
	CompletedFocusSearch: {},
})
export type Message = typeof Message.Type

export const SEARCH_ID = "create-dm-modal-search"

