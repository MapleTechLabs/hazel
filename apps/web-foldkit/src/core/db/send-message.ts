/** Re-exports `@hazel/client-data` (and the app's instance, `./client.ts`) at its old path. */
import type { ConnectConversationId } from "@hazel/schema"
import { prepareSend as prepareSendWith, type SendMessageVariables } from "@hazel/client-data"

export type { SendMessageVariables } from "@hazel/client-data"

export const prepareSend = (
	variables: SendMessageVariables,
	conversationId: ConnectConversationId | null,
	clientNonce: string = crypto.randomUUID(),
) => prepareSendWith(variables, conversationId, clientNonce)
