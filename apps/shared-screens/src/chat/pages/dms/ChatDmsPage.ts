// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/chat/dms` on a wide screen (today's `ChatDms` page): the user's direct messages as
 * cards, with "New message". A phone's DMs tab is the shared DMs screen (`dms/Dms.ts`) instead.
 */
import { UiSchema } from "@effect/ui"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { OpenModal } from "../../../app/requests"
import { Session } from "../../../app/session"
import {
	cardList,
	ChannelGroups,
	chatIndexSubscriptions,
	dmCard,
	EMPTY_GROUPS,
	Presence,
	scopeOf,
} from "../../components/ChannelCards"

export const ChatDmsMessage = UiSchema.TaggedEnum({
	UpdatedChannels: { groups: ChannelGroups },
	UpdatedPresence: { presence: Schema.Record(Schema.String, Presence) },
	PressedNewMessage: {},
})
export type ChatDmsMessage = typeof ChatDmsMessage.Type

export const ChatDmsProps = Schema.Struct({ session: Session })
export type ChatDmsProps = typeof ChatDmsProps.Type

export const ChatDmsModel = Schema.Struct({
	loaded: Schema.Boolean,
	groups: ChannelGroups,
	presence: Schema.Record(Schema.String, Presence),
})
export type ChatDmsModel = typeof ChatDmsModel.Type

export const ChatDmsPage = Hazel.component({
	name: "ChatDmsPage",
	props: ChatDmsProps,
	model: ChatDmsModel,
	message: ChatDmsMessage,
}).make({
	init: () => ({ loaded: false, groups: EMPTY_GROUPS, presence: {} }),
	update: {
		UpdatedChannels: ($, { groups }) => $.evolve({ groups: () => groups, loaded: () => true }),
		UpdatedPresence: ($, { presence }) => $.evolve({ presence: () => presence }),
		PressedNewMessage: ($) => $.run(OpenModal.make({ modal: { _tag: "CreateDm" } })),
	},
	subscriptions: ({ props, model }) =>
		chatIndexSubscriptions<ChatDmsMessage>(scopeOf(props.session), model.groups, {
			channels: (groups) => ChatDmsMessage.UpdatedChannels({ groups }),
			presence: (presence) => ChatDmsMessage.UpdatedPresence({ presence }),
		}),
	view: (h, model) => {
		const scope = scopeOf(h.props.session)
		if (scope === null || !model.loaded)
			return h.screen
				.key("chat-dms")
				.surface("page")
				.children(h.progress.style("spinner").label("Loading..."))
		const dms = model.groups.dmChannels
		const newMessage = h.button
			.label("New message")
			.icon("plus")
			.variant("secondary")
			.size("small")
			.on("press", ChatDmsMessage.PressedNewMessage())
		// HAZEL-GAP(p4-screen-page-column): today is a padded column under a display title; `page` is the phone bar.
		return h.screen
			.key("chat-dms")
			.surface("page")
			.title("Direct messages")
			.toolbar(newMessage)
			.children(
				dms.length === 0
					? h.emptyState
							.icon("messages")
							.title("No direct messages")
							.description("Start a conversation with someone in your organization.")
							.action(
								h.button
									.label("Start a conversation")
									.icon("plus")
									.variant("secondary")
									.size("small")
									.on("press", ChatDmsMessage.PressedNewMessage()),
							)
					: cardList(
							h,
							"dms",
							dms.map((channel) =>
								dmCard(h, scope.orgSlug, channel, scope.userId, model.presence),
							),
						),
			)
	},
})
