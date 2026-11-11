import type { ChannelId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Subscription, Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import type { HazelRpc } from "../rpc"
import * as PresenceMessage from "./presence/message"
import * as PresenceModel from "./presence/model"
import * as PresenceSubscription from "./presence/subscription"
import * as PresenceUpdate from "./presence/update"

/** App-wide background work the legacy providers did: presence (`PresenceProvider`). */

export const Model = Schema.Struct({
	presence: PresenceModel.Model,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	GotPresenceMessage: { message: PresenceMessage.Message },
})
export type Message = typeof Message.Type

export const init = (): Model => ({ presence: PresenceModel.init() })

type Return = Update.Return<Model, Message, HazelRpc>

const foldPresence = Update.foldChild({
	update: (presence: PresenceModel.Model, step: (presence: PresenceModel.Model) => PresenceUpdate.Return) =>
		step(presence),
	read: (model: Model) => Option.some(model.presence),
	write: (model, presence) => modifyFields(model, { presence: () => presence }),
	toParentMessage: (message: PresenceMessage.Message) => Message.GotPresenceMessage({ message }),
})

/** The user picked a status in the command palette (`usePresence().setStatus`). */
export const pickPresenceStatus = (model: Model, status: PresenceModel.PresenceStatus): Return =>
	foldPresence(model, (presence) => PresenceUpdate.pickStatus(presence, status))

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotPresenceMessage: ({ message: inner }) =>
			foldPresence(model, (presence) => PresenceUpdate.update(presence, inner)),
	})

/** What the root tells the platform: the org layout's user (null outside it) and the route's channel. */
export interface Input {
	readonly model: Model
	readonly userId: PresenceSubscription.Input["userId"]
	readonly activeChannelId: ChannelId | null
}

export const subscriptions = Subscription.lift(PresenceSubscription.subscriptions)<Input, Message>({
	read: (input) =>
		Option.some({
			model: input.model.presence,
			userId: input.userId,
			activeChannelId: input.userId === null ? null : input.activeChannelId,
		}),
	toParentMessage: (message) => Message.GotPresenceMessage({ message }),
})
