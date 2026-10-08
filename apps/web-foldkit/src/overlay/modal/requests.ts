import { BotId, ChannelId, MessageId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Schema } from "effect"

/**
 * What pages and the shell send in `RequestedModal`: one variant per legacy modal. DOM-free, so
 * `page/out-message.ts` (and page tests) can import it without loading the modal views.
 */

export const NewChannel = Schema.TaggedStruct("NewChannel", {})
export const CreateDm = Schema.TaggedStruct("CreateDm", {})
export const JoinChannel = Schema.TaggedStruct("JoinChannel", {})
export const EmailInvite = Schema.TaggedStruct("EmailInvite", {})
export const CreateOrganization = Schema.TaggedStruct("CreateOrganization", {})
export const CreateSection = Schema.TaggedStruct("CreateSection", {})
export const DeleteChannel = Schema.TaggedStruct("DeleteChannel", { channelId: ChannelId, channelName: Schema.String })
export const Feedback = Schema.TaggedStruct("Feedback", {})
export const SetStatus = Schema.TaggedStruct("SetStatus", {})
export const RenameChannel = Schema.TaggedStruct("RenameChannel", { channelId: ChannelId })
export const RenameThread = Schema.TaggedStruct("RenameThread", { threadId: ChannelId })
export const ChangeRole = Schema.TaggedStruct("ChangeRole", {
	userId: UserId,
	memberId: OrganizationMemberId,
	name: Schema.String,
	role: Schema.String,
	currentUserRole: Schema.String,
})
export const DeleteWorkspace = Schema.TaggedStruct("DeleteWorkspace", {
	organizationId: OrganizationId,
	organizationName: Schema.String,
})
export const RequestIntegration = Schema.TaggedStruct("RequestIntegration", {})
export const CreateBot = Schema.TaggedStruct("CreateBot", {})
export const EditBot = Schema.TaggedStruct("EditBot", {
	id: BotId,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	isPublic: Schema.Boolean,
	scopes: Schema.Array(Schema.String),
	allowedIntegrations: Schema.Array(Schema.String),
	/** Resolved like `BotAvatar` (`resolveBotAvatarUrl`): the machine user's avatar or null. */
	avatarUrl: Schema.NullOr(Schema.String),
})
export const InstallBotById = Schema.TaggedStruct("InstallBotById", {})
export const RegenerateBotToken = Schema.TaggedStruct("RegenerateBotToken", { botId: BotId, botName: Schema.String })
export const DeleteBot = Schema.TaggedStruct("DeleteBot", { botId: BotId, botName: Schema.String })
export const DeleteMessage = Schema.TaggedStruct("DeleteMessage", { messageId: MessageId })

export const ModalRequest = Schema.Union([
	NewChannel,
	CreateDm,
	JoinChannel,
	EmailInvite,
	CreateOrganization,
	CreateSection,
	DeleteChannel,
	Feedback,
	SetStatus,
	RenameChannel,
	RenameThread,
	ChangeRole,
	DeleteWorkspace,
	RequestIntegration,
	CreateBot,
	EditBot,
	InstallBotById,
	RegenerateBotToken,
	DeleteBot,
	DeleteMessage,
])
export type ModalRequest = typeof ModalRequest.Type
