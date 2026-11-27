/** Re-exports `@hazel/shared-screens/customers/data/chat-authors` at its old path, bound to the app's `clientData`. */
import { makeChatAuthorData } from "@hazel/shared-screens/customers/data/chat-authors"
import { clientData } from "~/db/client"

export * from "@hazel/shared-screens/customers/data/chat-authors"

export const {
	chatAuthorsStream,
	chatParticipantsStream,
	linkedChannelAuthorsStream,
	setChatAuthorSideAction,
} = makeChatAuthorData(clientData)
