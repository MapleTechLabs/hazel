import { and, eq } from "@tanstack/db"
import { Effect, Schema, Stream } from "effect"
import { Command, Subscription, type Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { channelCollection } from "~/db/collections"
import * as Composer from "../../composer/composer"
import { mentionMembersStream, presenceStream } from "../../composer/data"
import * as ComposerUpdate from "../../composer/update"
import * as ComposerView from "../../composer/view"
import { liveQueryStream } from "../../data/live-query"
import { HazelRpc } from "../../rpc"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

/** Mirrors `apps/web/src/dev-gallery/entries/composer.tsx`: the channel composer for #general. */

// MODEL

const Model = Schema.Struct({
	organizationId: Schema.NullOr(Schema.String),
	channelId: Schema.NullOr(Schema.String),
	composer: Composer.Model,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	SucceededFetchCurrentUser: { organizationId: Schema.NullOr(Schema.String) },
	FailedFetchCurrentUser: { reason: Schema.String },
	UpdatedChannel: { channelId: Schema.NullOr(Schema.String) },
	GotComposerMessage: { message: Composer.Message },
})
type Message = typeof Message.Type

// COMMAND

const FetchCurrentUser = Command.define("FetchCurrentUser", {
	messages: [Message.SucceededFetchCurrentUser, Message.FailedFetchCurrentUser],
	execute: Effect.gen(function* () {
		const client = yield* HazelRpc
		const user = yield* client("user.me", undefined)
		return Message.SucceededFetchCurrentUser({ organizationId: user.organizationId ?? null })
	}).pipe(
		Effect.catch((error) => Effect.succeed(Message.FailedFetchCurrentUser({ reason: String(error) }))),
	),
})

// UPDATE

type Return = Update.Return<Model, Message, HazelRpc>

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		SucceededFetchCurrentUser: ({ organizationId }) => ({ model: { ...model, organizationId } }),
		FailedFetchCurrentUser: () => ({ model }),
		UpdatedChannel: ({ channelId }) => ({ model: { ...model, channelId } }),
		GotComposerMessage: ({ message: composerMessage }) => {
			const result = ComposerUpdate.update(model.composer, composerMessage)
			return {
				model: { ...model, composer: result.model },
				commands: Command.mapMessages(result.commands ?? [], (child) =>
					Message.GotComposerMessage({ message: child }),
				),
			}
		},
	})

// SUBSCRIPTION

const toComposer = (message: Composer.Message) => Message.GotComposerMessage({ message })

const subscriptions = Subscription.make<Model, Message>()((entry) => ({
	channel: entry(
		{ organizationId: Schema.NullOr(Schema.String) },
		{
			modelToDependencies: (model) => ({ organizationId: model.organizationId }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: liveQueryStream<{ id: string }, Message>(
							(q) =>
								q
									.from({ channel: channelCollection })
									.where(({ channel }) =>
										and(
											eq(channel.organizationId, organizationId),
											eq(channel.name, "general"),
										),
									)
									.findOne(),
							(rows) => Message.UpdatedChannel({ channelId: rows[0]?.id ?? null }),
						),
		},
	),
	mentionMembers: entry(
		{ channelId: Schema.NullOr(Schema.String) },
		{
			modelToDependencies: (model) => ({ channelId: model.channelId }),
			dependenciesToStream: ({ channelId }) =>
				channelId === null
					? Stream.empty
					: mentionMembersStream(channelId, (members) =>
							toComposer(Composer.Message.UpdatedMentionMembers({ members })),
						),
		},
	),
	presence: Subscription.persistentEntry(
		presenceStream((presence) => toComposer(Composer.Message.UpdatedPresence({ presence }))),
	),
}))

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Composer", [
		gallerySection(h, "Channel composer", [
			h.div(
				[h.Class("w-[640px] pt-80")],
				model.organizationId !== null && model.channelId !== null
					? [
							h.submodel({
								slotId: "composer",
								model: model.composer,
								view: ComposerView.view,
								toParentMessage: toComposer,
							}),
						]
					: [],
			),
		]),
	])

export const gallery = defineGallery<Model, Message>("Composer", {
	Model,
	init: () => ({
		model: { organizationId: null, channelId: null, composer: Composer.init("gallery-composer") },
		commands: [FetchCurrentUser()],
	}),
	update,
	view,
	subscriptions,
})
