// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** For scenes: the row lookups the first window waits for (`awaiting`), each answered empty. */
import { MessageListMessage } from "./messages"

interface Steps<S> {
	readonly subscriptions: ReadonlyArray<string>
	readonly subscription: (key: string, message: MessageListMessage) => S
}

const EMPTY = [
	["users", MessageListMessage.UpdatedUsers({ users: [] })],
	["bots", MessageListMessage.UpdatedBots({ bots: [] })],
	["reactions", MessageListMessage.UpdatedReactions({ reactions: [] })],
	["attachments", MessageListMessage.UpdatedAttachments({ attachments: [] })],
] as const

/** Answers every row lookup empty, from its active Subscription (keyed by name and deps). */
export const answerRowLookups = <S extends Steps<S>>(steps: S): S =>
	EMPTY.reduce((current, [name, message]) => {
		const key = current.subscriptions.find((each) => each === name || each.startsWith(`${name}:`))
		if (key === undefined)
			throw new Error(`no ${name} subscription in ${current.subscriptions.join(", ")}`)
		return current.subscription(key, message)
	}, steps)
