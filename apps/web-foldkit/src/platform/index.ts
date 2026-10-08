import { Effect, Option, Schema } from "effect"
import { Command, ManagedResource, Subscription, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import type { HazelRpc } from "../rpc"
import * as PresenceMessage from "./presence/message"
import * as PresenceModel from "./presence/model"
import * as PresenceSubscription from "./presence/subscription"
import * as PresenceUpdate from "./presence/update"
import { acquireRivetClient, RivetClient } from "./rivet"

/** App-wide background work the legacy providers did: presence and the Rivet client. */

export const RivetStatus = Schema.Literals(["Connecting", "Ready", "Failed"])

export const Model = Schema.Struct({
	presence: PresenceModel.Model,
	rivet: RivetStatus,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	GotPresenceMessage: { message: PresenceMessage.Message },
	AcquiredRivetClient: {},
	ReleasedRivetClient: {},
	FailedAcquireRivetClient: { reason: Schema.String },
})
export type Message = typeof Message.Type

export const init = (): Model => ({ presence: PresenceModel.init(), rivet: "Connecting" })

type Return = Update.Return<Model, Message, HazelRpc>

const withPresence = (model: Model, result: PresenceUpdate.Return): Return => ({
	model: modifyFields(model, { presence: () => result.model }),
	commands: Command.mapMessages(result.commands, (child) => Message.GotPresenceMessage({ message: child })),
})

/** The user picked a status in the command palette (`usePresence().setStatus`). */
export const pickPresenceStatus = (model: Model, status: PresenceModel.PresenceStatus): Return =>
	withPresence(model, PresenceUpdate.pickStatus(model.presence, status))

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotPresenceMessage: ({ message: inner }) => withPresence(model, PresenceUpdate.update(model.presence, inner)),
		AcquiredRivetClient: () => ({ model: modifyFields(model, { rivet: () => "Ready" }) }),
		ReleasedRivetClient: () => ({ model: modifyFields(model, { rivet: () => "Connecting" }) }),
		FailedAcquireRivetClient: () => ({ model: modifyFields(model, { rivet: () => "Failed" }) }),
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

export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
	// Legacy creates the client when its module loads: on every route, signed in or not.
	rivetClient: entry(Schema.Option(Schema.Null), {
		resource: RivetClient,
		modelToMaybeRequirements: () => Option.some(null),
		acquire: () => acquireRivetClient,
		release: () => Effect.void,
		onAcquired: () => Message.AcquiredRivetClient(),
		onReleased: () => Message.ReleasedRivetClient(),
		onAcquireError: (error) => Message.FailedAcquireRivetClient({ reason: String(error) }),
	}),
}))
