/** Re-exports `@hazel/client-data` (and the app's instance, `./client.ts`) at its old path. */
import { clientData } from "./client"

export const {
	channelOfMessage,
	channelOfPin,
	orgOfChannel,
	orgOfChannelMember,
	orgOfMember,
	orgOfSection,
	orgOfEmoji,
	orgOfChatSyncConnection,
	orgOfChatSyncChannelLink,
} = clientData.hints
