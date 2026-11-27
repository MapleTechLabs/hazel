/** Re-exports `@hazel/client-data` (and the app's instance, `./client.ts`) at its old path. */
import { clientData } from "./client"

export const {
	sendMessageAction,
	createChannelAction,
	toggleReactionAction,
	createThreadAction,
	editMessageAction,
	deleteMessageAction,
	pinMessageAction,
	unpinMessageAction,
	updateChannelAction,
	deleteChannelAction,
	joinChannelAction,
	updateChannelMemberAction,
	createChannelSectionAction,
	deleteChannelSectionAction,
	moveChannelToSectionAction,
	updateOrganizationAction,
	setPublicModeAction,
	updateMemberRoleAction,
	createCustomEmojiAction,
	restoreCustomEmojiAction,
	deleteCustomEmojiAction,
} = clientData.actions
