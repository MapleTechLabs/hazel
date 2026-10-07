import { Option, Schema } from "effect"
import { Command, Subscription, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import type { HazelRpc } from "../rpc"
import * as PresenceMessage from "./presence/message"
import * as PresenceModel from "./presence/model"
import * as PresenceSubscription from "./presence/subscription"
import * as PresenceUpdate from "./presence/update"

/** App-wide background work the legacy providers did: presence. */

export const Model = Schema.Struct({
	presence: PresenceModel.Model,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	GotPresenceMessage: { message: PresenceMessage.Message },
})
export type Message = typeof Message.Type

export const init = (): Model => ({ presence: PresenceModel.init() })

export const update = (model: Model, message: Message): Update.Return<Model, Message, HazelRpc> =>
	Message.match<Update.Return<Model, Message, HazelRpc>>(message, {
		GotPresenceMessage: ({ message: inner }) => {
			const result = PresenceUpdate.update(model.presence, inner)
			return {
				model: modifyFields(model, { presence: () => result.model }),
				commands: Command.mapMessages(result.commands, (child) =>
					Message.GotPresenceMessage({ message: child }),
				),
			}
		},
	})

/** What the root tells the platform: the org layout's user (null outside it) and the pathname. */
export interface Input {
	readonly model: Model
	readonly userId: PresenceSubscription.Input["userId"]
	readonly pathname: string
}

export const subscriptions = Subscription.lift(PresenceSubscription.subscriptions)<Input, Message>({
	read: (input) =>
		Option.some({
			model: input.model.presence,
			userId: input.userId,
			activeChannelId: input.userId === null ? null : PresenceModel.channelIdOfPathname(input.pathname),
		}),
	toParentMessage: (message) => Message.GotPresenceMessage({ message }),
})
