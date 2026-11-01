/** Every chat-sync provider's definition (pure), by id. */
import { Option } from "effect"
import { type ChatSyncProviderDefinition, type ChatSyncProviderId, isChatSyncProviderId } from "../provider"
import { discord } from "./discord/definition"

export const chatSyncProviders: Record<ChatSyncProviderId, ChatSyncProviderDefinition> = { discord }

/** A stored provider name's definition; `None` for one this build does not know. */
export const definitionOf = (provider: string): Option.Option<ChatSyncProviderDefinition> =>
	isChatSyncProviderId(provider) ? Option.some(chatSyncProviders[provider]) : Option.none()
