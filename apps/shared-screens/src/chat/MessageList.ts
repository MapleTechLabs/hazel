// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Phase 1 exit screen: the channel's message list and its rows (`web-foldkit/src/chat/message/row.ts`,
 * `page/chat/channel/view.ts`) in `hazel`. Type-checks against C1; not rendered yet. Each message is one
 * `message` leaf whose row is data (G7 option C); the list anchors at its end and sticks to the bottom.
 */
import { UiSchema } from "@effect/ui"
import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Content, Hazel, MessageAction } from "@hazel/ui/vocabulary/index"
import { Match, Schema } from "effect"

/** A message as the screen holds it: already shaped by its query into the row the primitive draws. */
export const Message = Schema.Struct({
	id: MessageId,
	authorId: UserId,
	row: Content.MessageRow,
	grouped: Schema.Boolean,
	pinned: Schema.Boolean,
	highlighted: Schema.Boolean,
	pending: Schema.Boolean,
	failed: Schema.Boolean,
})
export type Message = typeof Message.Type

export const Entry = Schema.Union([
	Schema.TaggedStruct("Date", { key: Schema.String, label: Schema.String }),
	Schema.TaggedStruct("Unread", { key: Schema.String }),
	Schema.TaggedStruct("Row", { message: Message }),
])
export type Entry = typeof Entry.Type

export const MessageListMessage = UiSchema.TaggedEnum({
	ReachedStart: {},
	ReachedEnd: {},
	PressedAction: { id: MessageId, action: MessageAction },
	PressedReaction: { id: MessageId, emoji: Schema.String },
	PressedAddReaction: { id: MessageId },
	PressedAuthor: { id: MessageId },
	PressedMention: { userId: Schema.String },
	PressedLink: { url: Schema.String },
	PressedAttachment: { id: MessageId, attachmentId: Schema.String },
	PressedReply: { id: MessageId },
	PressedThread: { id: MessageId },
	PressedRetry: { id: MessageId },
	PressedJumpToUnread: {},
	PressedMarkRead: {},
	PressedJoin: {},
})
export type MessageListMessage = typeof MessageListMessage.Type

export const MessageListProps = Schema.Struct({ channelId: ChannelId, channelName: Schema.String })

/** One row: the leaf, its states, and every event it raises mapped to the screen's messages. */
const messageRow = (h: Hazel.H<MessageListMessage>, message: Message) =>
	h.message
		.key(message.id)
		.row(message.row)
		.grouped(message.grouped)
		.pinned(message.pinned)
		.highlighted(message.highlighted)
		.pending(message.pending)
		.failed(message.failed)
		// HAZEL-GAP(message-provider): the Slack or Discord mark after a synced author's name.
		// HAZEL-GAP(reaction-who): a reaction's tooltip names who reacted; `Reaction` carries a count only.
		// HAZEL-GAP(quick-reactions): the hover toolbar's three quick emoji before "Add reaction".
		// HAZEL-GAP(message-action-issue): "Create issue" in the More menu has no `MessageAction`.
		.on("action", ({ action }) => MessageListMessage.PressedAction({ id: message.id, action }))
		.on("pressReaction", ({ emoji }) => MessageListMessage.PressedReaction({ id: message.id, emoji }))
		.on("addReaction", () => MessageListMessage.PressedAddReaction({ id: message.id }))
		.on("pressAuthor", () => MessageListMessage.PressedAuthor({ id: message.id }))
		// HAZEL-GAP(anchor-in-leaf): a mention opens a profile popover anchored at the mention inside the row.
		.on("pressMention", ({ userId }) => MessageListMessage.PressedMention({ userId }))
		.on("pressLink", ({ url }) => MessageListMessage.PressedLink({ url }))
		.on("pressAttachment", ({ id }) =>
			MessageListMessage.PressedAttachment({ id: message.id, attachmentId: id }),
		)
		.on("pressReply", () => MessageListMessage.PressedReply({ id: message.id }))
		.on("pressThread", () => MessageListMessage.PressedThread({ id: message.id }))
		.on("retry", () => MessageListMessage.PressedRetry({ id: message.id }))

const entry = (h: Hazel.H<MessageListMessage>, item: Entry) =>
	Match.valueTags(item, {
		Date: ({ key, label }) => h.listDivider.key(key).label(label),
		Unread: ({ key }) => h.listDivider.key(key).kind("unread").label("New"),
		Row: ({ message }) => messageRow(h, message),
	})

export const MessageList = Hazel.component({
	name: "MessageList",
	props: MessageListProps,
	model: Schema.Struct({
		entries: Schema.Array(Entry),
		loading: Schema.Boolean,
		loadingOlder: Schema.Boolean,
		isMember: Schema.Boolean,
		unreadSince: Schema.NullOr(Schema.Struct({ count: Schema.Finite, label: Schema.String })),
	}),
	message: MessageListMessage,
}).make({
	init: () => ({ entries: [], loading: true, loadingOlder: false, isMember: true, unreadSince: null }),
	update: {
		ReachedStart: ($) => $.evolve({ loadingOlder: () => true }),
		ReachedEnd: ($) => $.model,
		PressedAction: ($) => $.model,
		PressedReaction: ($) => $.model,
		PressedAddReaction: ($) => $.model,
		PressedAuthor: ($) => $.model,
		PressedMention: ($) => $.model,
		PressedLink: ($) => $.model,
		PressedAttachment: ($) => $.model,
		PressedReply: ($) => $.model,
		PressedThread: ($) => $.model,
		PressedRetry: ($) => $.model,
		PressedJumpToUnread: ($) => $.model,
		PressedMarkRead: ($) => $.evolve({ unreadSince: () => null }),
		PressedJoin: ($) => $.evolve({ isMember: () => true }),
	},
	view: (h, model) =>
		h.stack.density("compact").children(
			model.unreadSince === null
				? null
				: // HAZEL-GAP(list-overlay-bar): the "N new messages since" bar floats over the list's top edge.
					h.frame.surface("muted").children(
						h.stack
							.axis("horizontal")
							.align("center")
							.children(
								h.text
									.role("label")
									.children(
										`${model.unreadSince.count} new messages since ${model.unreadSince.label}`,
									),
								h.spacer,
								h.button
									.label("Jump")
									.variant("ghost")
									.size("xsmall")
									.on("press", MessageListMessage.PressedJumpToUnread()),
								h.button
									.label("Mark as read")
									.variant("ghost")
									.size("xsmall")
									.on("press", MessageListMessage.PressedMarkRead()),
							),
					),
			model.loading
				? // HAZEL-GAP(skeleton): the list's loading state is skeleton rows, not a spinner.
					h.list.loadingEnd()
				: model.entries.length === 0
					? h.stack.align("center").children(
							// HAZEL-GAP(empty-illustration): the empty state's illustration is an asset, not a url.
							h.text.tone("muted").children("Quiet as an ocean gazing squirrel..."),
						)
					: h.list
							.anchor("end")
							.stickToBottom()
							.loadingStart(model.loadingOlder)
							.on("reachStart", MessageListMessage.ReachedStart())
							.on("reachEnd", MessageListMessage.ReachedEnd())
							.children(...model.entries.map((item) => entry(h, item))),
			model.isMember
				? null
				: h.frame.children(
						h.stack
							.align("center")
							.children(
								h.icon.name("hashtag"),
								h.heading.level("2").children(h.props.channelName),
								h.button
									.label(`Join #${h.props.channelName}`)
									.size("large")
									.on("press", MessageListMessage.PressedJoin()),
							),
					),
		),
})
