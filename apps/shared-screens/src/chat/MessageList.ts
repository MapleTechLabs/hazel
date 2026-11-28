// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The channel's message list (Phase 3), today's `web-foldkit/src/page/chat/channel/view.ts` list in
 * `hazel`. Each message is one `message` leaf whose row is data (G7 option C); the list anchors at
 * its end, sticks to the bottom and pages older messages in from its top. The host provides the data
 * (`messageListLayer`) and handles what a row asks of it (`RequestHost`).
 */
import { Subscription } from "@effect/ui"
import { ChannelId, HtmlRenderId, MessageId, UserId } from "@hazel/schema"
import { HtmlRender } from "@hazel/ui/extensions/HtmlRender"
import { Content, Hazel, type IconName, type MessageAction } from "@hazel/ui/vocabulary/index"
import { Match, Option, Schema } from "effect"
import { ProfileCard, type ProfilePerson, ProfilePresence } from "./components/ProfileCard"
import { initialsOf, sinceLabel } from "./format"
import { EmojiPicker } from "./pickers/EmojiPicker"
import {
	activityStream,
	attachmentsStream,
	botsStream,
	clockStream,
	historyStream,
	ListRef,
	liveStream,
	messagesStream,
	MoveWindow,
	PAGE_SIZE,
	profilePresenceStream,
	reactionsStream,
	readPositionStream,
	replyTargetsStream,
	RequestHost,
	ScrollToRow,
	SelectRowText,
	threadMessagesStream,
	threadNamesStream,
	ToggleReaction,
	TogglePin,
	usersStream,
} from "./live"
import {
	ChatAttachment,
	ChatMessage,
	ChatReaction,
	ChatUser,
	Activity,
	MessageListMessage,
	Named,
	ReplyTarget,
	ThreadMessage,
} from "./messages"
import {
	type Entry,
	type Lookups,
	firstNewIdOf,
	newCountOf,
	type RowEntry,
	rowWithCards,
	toEntries,
	displayNameOf,
	providerOf,
} from "./rows"

import { HtmlRenderRef, PreviewRequest } from "./rich/embeds"
import { GetHtmlRenderUrl } from "./rich/html-renders"
import { initialLiveState, LiveActorState, reduceLive } from "./rich/live-replies"
import { GetLinkPreview, GetTweet, unfurlArgs, unfurlCardOf } from "./rich/unfurls"

export { MessageListMessage } from "./messages"

const EntrySchema = Schema.Union([
	Schema.TaggedStruct("Date", { key: Schema.String, label: Schema.String }),
	Schema.TaggedStruct("Unread", { key: Schema.String }),
	Schema.TaggedStruct("Row", {
		key: MessageId,
		authorId: UserId,
		threadChannelId: Schema.NullOr(ChannelId),
		isPinned: Schema.Boolean,
		isOwn: Schema.Boolean,
		grouped: Schema.Boolean,
		entering: Schema.Boolean,
		row: Content.MessageRow,
		previews: Schema.Array(PreviewRequest),
		renders: Schema.Array(HtmlRenderRef),
	}),
])

export const MessageListProps = Schema.Struct({
	channelId: ChannelId,
	userId: UserId,
	/** Where attachments without their own url live (today's `currentServer().cdn`). */
	cdnUrl: Schema.String,
	/** The install's link-preview worker, which unfurls links (today's `currentServer().linkPreview`). */
	linkPreviewUrl: Schema.String,
	/** The clock at mount; `Ticked` moves it on. */
	nowMs: Schema.Finite,
})
export type MessageListProps = typeof MessageListProps.Type

/** The lookups that set a row's height (its header, reactions and pictures). */
const RowLookup = Schema.Literals(["users", "bots", "reactions", "attachments"])
type RowLookup = typeof RowLookup.Type
const ROW_LOOKUPS: ReadonlyArray<RowLookup> = ["users", "bots", "reactions", "attachments"]

export const MessageListModel = Schema.Struct({
	/**
	 * Row lookups that have not answered yet. The first window waits for them, so its rows paint once,
	 * at their final heights (a cold load answers users after messages: headers would pop in).
	 */
	awaiting: Schema.Array(RowLookup),
	/** The window, newest first; null until the query first answers. */
	messages: Schema.NullOr(Schema.Array(ChatMessage)),
	/** How many of the newest messages the window holds. */
	limit: Schema.Finite,
	/** The channel's history has older messages than are loaded. */
	hasMore: Schema.Boolean,
	loadingOlder: Schema.Boolean,
	reactions: Schema.Array(ChatReaction),
	users: Schema.Array(ChatUser),
	bots: Schema.Array(Named),
	attachments: Schema.Array(ChatAttachment),
	threadNames: Schema.Array(Named),
	threadMessages: Schema.Array(ThreadMessage),
	replyTargets: Schema.Array(ReplyTarget),
	/** The channel's newest message, once its query answered (`undefined` before). */
	activity: Schema.optional(Schema.NullOr(Activity)),
	/** The read position, once its query answered (`undefined` before). */
	readUpToMs: Schema.optional(Schema.NullOr(Schema.Finite)),
	/** The read position when the list opened, if anything was new: the "New" line and bar sit after it. */
	sinceMs: Schema.NullOr(Schema.Finite),
	sinceCaptured: Schema.Boolean,
	/** "Jump" asked for the "New" line before it was loaded. */
	jumpPending: Schema.Boolean,
	entries: Schema.Array(EntrySchema),
	nowMs: Schema.Finite,
	/** The message the emoji picker reacts to. */
	picker: Schema.NullOr(MessageId),
	/** The open profile card: whose, and where it anchors (a mention's run, or -1 for the row). */
	profile: Schema.NullOr(Schema.Struct({ id: MessageId, userId: Schema.String, run: Schema.Finite })),
	/** The open profile's presence, once its query answered. */
	profilePresence: Schema.NullOr(ProfilePresence),
	/** The message whose action sheet is open. */
	menu: Schema.NullOr(MessageId),
	/** Each live reply's state so far, by message id. */
	live: Schema.Record(Schema.String, LiveActorState),
	/** The HTML render shown fullscreen. */
	fullscreen: Schema.NullOr(Schema.Struct({ messageId: MessageId, renderId: HtmlRenderId })),
})
export type MessageListModel = typeof MessageListModel.Type

const byKey = <A, K extends string>(items: ReadonlyArray<A>, key: (item: A) => K | null) => {
	const map = new Map<string, Array<A>>()
	for (const item of items) {
		const k = key(item)
		if (k === null) continue
		let list = map.get(k)
		if (list === undefined) map.set(k, (list = []))
		list.push(item)
	}
	return map
}

/** `build` once per source: a change elsewhere in the model keeps this index, and its entries, `===`. */
const indexOnce = <K extends object, A>(build: (source: K) => A) => {
	const built = new WeakMap<K, A>()
	return (source: K): A => {
		let index = built.get(source)
		if (index === undefined) built.set(source, (index = build(source)))
		return index
	}
}

const usersIndex = indexOnce(
	(users: MessageListModel["users"]) => new Map(users.map((user) => [user.id, user])),
)
const botsIndex = indexOnce(
	(bots: MessageListModel["bots"]) => new Map(bots.map((bot) => [bot.id, bot.name])),
)
const reactionsIndex = indexOnce((reactions: MessageListModel["reactions"]) =>
	byKey(reactions, (reaction) => reaction.messageId),
)
const attachmentsIndex = indexOnce((attachments: MessageListModel["attachments"]) =>
	byKey(attachments, (attachment) => attachment.messageId),
)
const threadsIndex = indexOnce((names: MessageListModel["threadNames"]) =>
	indexOnce((messages: MessageListModel["threadMessages"]) => {
		const threadNames = new Map(names.map((thread) => [thread.id, thread.name]))
		const threadMessages = byKey(messages, (message) => message.channelId)
		return new Map(
			[...threadNames.keys(), ...threadMessages.keys()].map((id) => [
				id,
				{ name: threadNames.get(id) ?? "", messages: threadMessages.get(id) ?? [] },
			]),
		)
	}),
)
const replyTargetsIndex = indexOnce(
	(targets: MessageListModel["replyTargets"]) => new Map(targets.map((target) => [target.id, target])),
)
const liveIndex = indexOnce((live: MessageListModel["live"]) => new Map(Object.entries(live)))
const NONE: ReadonlyMap<string, string> = new Map()

/** The lookups a derivation reads, each indexed once per source. */
export const lookupsOf = (model: MessageListModel, userId: UserId): Lookups => ({
	currentUserId: userId,
	users: usersIndex(model.users),
	botNames: botsIndex(model.bots),
	groupHandles: NONE,
	reactions: reactionsIndex(model.reactions),
	attachments: attachmentsIndex(model.attachments),
	threads: threadsIndex(model.threadNames)(model.threadMessages),
	replyTargets: replyTargetsIndex(model.replyTargets),
	emojiUrls: NONE,
	live: liveIndex(model.live),
	nowMs: model.nowMs,
})

/** The window's entries again, after any of their inputs changed. */
export const derive = (model: MessageListModel, userId: UserId): MessageListModel => {
	if (model.messages === null) return model
	const firstNewId = firstNewIdOf(model.messages, model.sinceMs, userId)
	const entries = toEntries(model.messages, lookupsOf(model, userId), model.entries, firstNewId)
	const loadingOlder = model.loadingOlder && model.messages.length < model.limit && model.hasMore
	return { ...model, entries, loadingOlder }
}

/**
 * The read position the visit started from, once both its queries answered (today's
 * `new-messages.ts` `capture`): kept only when someone else wrote after it.
 */
export const capture = (model: MessageListModel, userId: UserId): MessageListModel => {
	if (model.sinceCaptured || model.activity === undefined || model.readUpToMs === undefined) return model
	const since = model.readUpToMs
	const activity = model.activity
	const isNew =
		since !== null &&
		activity !== null &&
		activity.lastMessageAuthorId !== userId &&
		activity.lastMessageAtMs > since
	return { ...model, sinceCaptured: true, sinceMs: isNew ? since : null }
}

/** A change set over the window: rows in `order`, upserts replacing, the rest kept. */
export const applyChanges = (
	previous: ReadonlyArray<typeof ChatMessage.Type> | null,
	order: ReadonlyArray<MessageId>,
	upserts: ReadonlyArray<typeof ChatMessage.Type>,
): ReadonlyArray<typeof ChatMessage.Type> => {
	const byId = new Map((previous ?? []).map((message) => [message.id, message]))
	for (const message of upserts) byId.set(message.id, message)
	return order.flatMap((id) => {
		const message = byId.get(id)
		return message === undefined ? [] : [message]
	})
}

/** `lookup` answered: the first window no longer waits for it. */
const answered = (model: MessageListModel, lookup: RowLookup): MessageListModel =>
	model.awaiting.includes(lookup)
		? { ...model, awaiting: model.awaiting.filter((each) => each !== lookup) }
		: model

/** The window can show: its query answered, and every lookup that sizes a row did too. */
export const windowReady = (model: MessageListModel) => model.messages !== null && model.awaiting.length === 0

/** Older messages may exist: the window is full, or the history says so. */
export const hasOlder = (model: MessageListModel) =>
	model.messages !== null && (model.messages.length >= model.limit || model.hasMore)

/** Reaching the top pages in when the window is full (a short window is still filling). */
export const nextLimit = (model: MessageListModel): number | null =>
	model.messages === null || model.loadingOlder || model.messages.length < model.limit
		? null
		: model.limit + PAGE_SIZE

const rowOf = (model: MessageListModel, id: MessageId): RowEntry | undefined =>
	model.entries.find((entry): entry is RowEntry => entry._tag === "Row" && entry.key === id)

const messageOf = (model: MessageListModel, id: MessageId) =>
	model.messages?.find((message) => message.id === id)

const hasUnreadLine = (model: MessageListModel) => model.entries.some((entry) => entry._tag === "Unread")

/** `$.evolve` that sets every field of `next`: a derived Model with Commands to run. */
const all = <M extends object>(next: M) =>
	// SAFETY: one thunk per own key of `next`, which is what `evolve` takes.
	Object.fromEntries(Object.entries(next).map(([key, value]) => [key, () => value])) as {
		readonly [K in keyof M]: () => M[K]
	}

const joined = (ids: ReadonlyArray<string>) => [...new Set(ids)].sort().join(",")

/** Each action's label and icon in the long-press sheet (the web toolbar's `actionLook`). */
const ACTION_LOOK = {
	react: { label: "Add reaction", icon: "emoji-add" },
	reply: { label: "Reply", icon: "reply" },
	thread: { label: "Reply in thread", icon: "thread" },
	copy: { label: "Copy message", icon: "copy" },
	edit: { label: "Edit message", icon: "edit" },
	pin: { label: "Pin message", icon: "pin" },
	unpin: { label: "Unpin message", icon: "pin" },
	issue: { label: "Create issue", icon: "lightbulb" },
	selectText: { label: "Select text", icon: "copy" },
	delete: { label: "Delete message", icon: "trash" },
	copyImage: { label: "Copy image", icon: "image" },
	copyImageUrl: { label: "Copy image address", icon: "link" },
	copyId: { label: "Copy message ID", icon: "copy" },
} as const satisfies Record<MessageAction, { readonly label: string; readonly icon: IconName }>

/** Holding already selects the text natively, and the sheet has no image under a pointer. */
const SHEET_SKIPS: ReadonlyArray<MessageAction> = ["copyImage", "copyImageUrl"]

/** What a row action does: open the picker, run a Command, or nothing (`selectText` is the host's). */
const actionStep = (
	props: MessageListProps,
	model: MessageListModel,
	message: typeof ChatMessage.Type,
	action: MessageAction,
	image?: string,
) =>
	Match.value(action).pipe(
		Match.when("react", () => "picker" as const),
		// The host acts first for `selectText` (native selection on iOS); nothing more here.
		Match.when("selectText", () => null),
		Match.whenOr("pin", "unpin", () =>
			TogglePin.make({
				messageId: message.id,
				channelId: props.channelId,
				userId: props.userId,
				pinnedId: message.pinnedId,
			}),
		),
		Match.when("thread", () =>
			RequestHost.make({
				request: {
					_tag: "OpenThread",
					messageId: message.id,
					threadChannelId: message.threadChannelId,
				},
			}),
		),
		Match.orElse(() => {
			const request = {
				_tag: "Action",
				messageId: message.id,
				action,
				content: message.content,
				author: displayNameOf(lookupsOf(model, props.userId), message.authorId) ?? "",
			} as const
			// The image under the pointer, for the web menu's `copyImage` and `copyImageUrl`.
			return RequestHost.make({ request: image === undefined ? request : { ...request, image } })
		}),
	)

/** The anchor run of a profile opened from the author: no run has it, so the row itself anchors. */
const AUTHOR_RUN = -1

/** Who a profile card shows, from the list's users and bots. */
export const personOf = (
	model: MessageListModel,
	viewerId: UserId,
	userId: string,
): ProfilePerson | undefined => {
	const lookups = lookupsOf(model, viewerId)
	const user = lookups.users.get(userId)
	const name = displayNameOf(lookups, userId)
	if (user === undefined || name === undefined) return undefined
	const provider = providerOf(user)
	return {
		name,
		initials: initialsOf(name),
		avatar: user.avatarUrl ?? undefined,
		email: user.email,
		timezone: user.timezone ?? null,
		isBot: user.userType === "machine" && provider === undefined,
		provider,
		isOwn: user.id === viewerId,
	}
}

/** Every link the rows unfurl. */
const previewsOf = (model: MessageListModel) =>
	model.entries.flatMap((entry) => (entry._tag === "Row" ? entry.previews : []))

/** Every HTML render the rows draw, as its URL query's args. */
const renderArgsOf = (model: MessageListModel, channelId: ChannelId) =>
	model.entries.flatMap((entry) =>
		entry._tag === "Row"
			? entry.renders.map((render) => ({ channelId, messageId: entry.key, renderId: render.renderId }))
			: [],
	)

/** Replies that stream over a socket: live, and not answered from their cached snapshot. */
const liveRepliesOf = (model: MessageListModel) =>
	(model.messages ?? []).flatMap((message) =>
		message.rich.live !== null && message.rich.live.cached === null
			? [{ messageId: message.id, channelId: message.channelId }]
			: [],
	)

export const MessageList = Hazel.component({
	name: "MessageList",
	props: MessageListProps,
	model: MessageListModel,
	message: MessageListMessage,
	queries: {
		previews: {
			queryMany: GetLinkPreview,
			args: ({ props, model }) => unfurlArgs(props.linkPreviewUrl, previewsOf(model)).links,
		},
		tweets: {
			queryMany: GetTweet,
			args: ({ props, model }) => unfurlArgs(props.linkPreviewUrl, previewsOf(model)).tweets,
		},
		renders: {
			queryMany: GetHtmlRenderUrl,
			args: ({ props, model }) => renderArgsOf(model, props.channelId),
		},
	},
}).make({
	init: ({ props }) => ({
		awaiting: ROW_LOOKUPS,
		messages: null,
		limit: PAGE_SIZE,
		hasMore: true,
		loadingOlder: false,
		reactions: [],
		users: [],
		bots: [],
		attachments: [],
		threadNames: [],
		threadMessages: [],
		replyTargets: [],
		sinceMs: null,
		sinceCaptured: false,
		jumpPending: false,
		entries: [],
		nowMs: props.nowMs,
		picker: null,
		profile: null,
		profilePresence: null,
		menu: null,
		live: {},
		fullscreen: null,
	}),
	update: {
		UpdatedMessages: ($, { order, upserts }) => {
			const next = derive(
				{ ...$.model, messages: applyChanges($.model.messages, order, upserts) },
				$.props.userId,
			)
			if (!next.jumpPending || !hasUnreadLine(next)) return next
			return $.evolve(all({ ...next, jumpPending: false })).run(ScrollToRow.make({ key: "unread" }))
		},
		UpdatedHistory: ($, { hasMore }) => derive({ ...$.model, hasMore }, $.props.userId),
		UpdatedReactions: ($, { reactions }) =>
			derive({ ...answered($.model, "reactions"), reactions }, $.props.userId),
		UpdatedUsers: ($, { users }) => derive({ ...answered($.model, "users"), users }, $.props.userId),
		UpdatedBots: ($, { bots }) => derive({ ...answered($.model, "bots"), bots }, $.props.userId),
		UpdatedAttachments: ($, { attachments }) =>
			derive({ ...answered($.model, "attachments"), attachments }, $.props.userId),
		UpdatedThreadNames: ($, { threads }) => derive({ ...$.model, threadNames: threads }, $.props.userId),
		UpdatedThreadMessages: ($, { messages }) =>
			derive({ ...$.model, threadMessages: messages }, $.props.userId),
		UpdatedReplyTargets: ($, { targets }) =>
			derive({ ...$.model, replyTargets: targets }, $.props.userId),
		UpdatedReadPosition: ($, { readUpToMs }) =>
			derive(capture({ ...$.model, readUpToMs }, $.props.userId), $.props.userId),
		UpdatedActivity: ($, { activity }) =>
			derive(capture({ ...$.model, activity }, $.props.userId), $.props.userId),
		Ticked: ($, { nowMs }) => derive({ ...$.model, nowMs }, $.props.userId),
		ReachedStart: ($) => {
			const limit = nextLimit($.model)
			return limit === null
				? $.model
				: $.evolve({ limit: () => limit, loadingOlder: () => true }).run(
						MoveWindow.make({ channelId: $.props.channelId, limit }),
					)
		},
		ReachedEnd: ($) => $.model,
		PressedAction: ($, { id, action, image }) => {
			const message = messageOf($.model, id)
			const step = message === undefined ? null : actionStep($.props, $.model, message, action, image)
			return step === null ? $.model : step === "picker" ? $.evolve({ picker: () => id }) : $.run(step)
		},
		PressedReaction: ($, { id, emoji }) =>
			$.run(
				ToggleReaction.make({
					messageId: id,
					channelId: $.props.channelId,
					userId: $.props.userId,
					emoji,
				}),
			),
		PressedAddReaction: ($, { id }) => $.evolve({ picker: () => id }),
		LongPressedMessage: ($, { id }) => $.evolve({ menu: () => id }),
		DismissedMenu: ($) => $.evolve({ menu: () => null }),
		PressedMenuAction: ($, { action }) => {
			const id = $.model.menu
			if (id === null) return $.model
			// "Select Text": the sheet closes and the row's text is selected natively, as in Messages.
			if (action === "selectText")
				return $.evolve({ menu: () => null }).run(SelectRowText.make({ key: id }))
			const message = messageOf($.model, id)
			const step = message === undefined ? null : actionStep($.props, $.model, message, action)
			return step === null
				? $.evolve({ menu: () => null })
				: step === "picker"
					? $.evolve({ menu: () => null, picker: () => id })
					: $.evolve({ menu: () => null }).run(step)
		},
		PressedMenuReaction: ($, { emoji }) =>
			$.model.menu === null
				? $.model
				: $.evolve({ menu: () => null }).run(
						ToggleReaction.make({
							messageId: $.model.menu,
							channelId: $.props.channelId,
							userId: $.props.userId,
							emoji,
						}),
					),
		PickedReactionEmoji: ($, { emoji }) =>
			$.model.picker === null
				? $.model
				: $.evolve({ picker: () => null }).run(
						ToggleReaction.make({
							messageId: $.model.picker,
							channelId: $.props.channelId,
							userId: $.props.userId,
							emoji,
						}),
					),
		RequestedCloseEmojiPicker: ($) => $.evolve({ picker: () => null }),
		PressedAuthor: ($, { id }) => {
			const row = rowOf($.model, id)
			// Today's avatar popover; the row anchors it (`AUTHOR_RUN` matches no run).
			return row === undefined
				? $.model
				: $.evolve({
						profile: () => ({ id, userId: row.authorId, run: AUTHOR_RUN }),
						profilePresence: () => null,
					})
		},
		PressedMention: ($, { id, userId, run }) =>
			$.evolve({ profile: () => ({ id, userId, run }), profilePresence: () => null }),
		DismissedProfile: ($) => $.evolve({ profile: () => null }),
		UpdatedProfilePresence: ($, { presence }) =>
			$.model.profile === null ? $.model : $.evolve({ profilePresence: () => presence }),
		PressedEditProfile: ($) =>
			$.evolve({ profile: () => null }).run(RequestHost.make({ request: { _tag: "EditProfile" } })),
		// A bot card without a link has an empty url: nothing to open.
		PressedLink: ($, { url }) =>
			url === "" ? $.model : $.run(RequestHost.make({ request: { _tag: "OpenLink", url } })),
		PressedAttachment: ($, { id, attachmentId }) => {
			const files = rowOf($.model, id)?.row.files ?? []
			const file = files.find((each) => each.id === attachmentId)
			if (file === undefined) return $.model
			const media = files.filter((each) => each.kind !== "file")
			return $.run(
				RequestHost.make({
					request: {
						_tag: "OpenAttachment",
						messageId: id,
						attachmentId,
						url: file.url ?? "",
						index: file.kind === "file" ? -1 : media.indexOf(file),
					},
				}),
			)
		},
		PressedReply: ($, { id }) => {
			const target = messageOf($.model, id)?.replyToMessageId ?? null
			if (target === null) return $.model
			return rowOf($.model, target) === undefined
				? $.run(
						RequestHost.make({
							request: { _tag: "JumpToReply", fromMessageId: id, messageId: target },
						}),
					)
				: $.run(ScrollToRow.make({ key: target }))
		},
		PressedThread: ($, { id }) =>
			$.run(
				RequestHost.make({
					request: {
						_tag: "OpenThread",
						messageId: id,
						threadChannelId: messageOf($.model, id)?.threadChannelId ?? null,
					},
				}),
			),
		PressedRetry: ($, { id }) => $.run(RequestHost.make({ request: { _tag: "Retry", messageId: id } })),
		PressedJumpToUnread: ($) => {
			if (hasUnreadLine($.model)) return $.run(ScrollToRow.make({ key: "unread" }))
			const limit = nextLimit($.model)
			return limit === null
				? $.evolve({ jumpPending: () => true })
				: $.evolve({ limit: () => limit, loadingOlder: () => true, jumpPending: () => true }).run(
						MoveWindow.make({ channelId: $.props.channelId, limit }),
					)
		},
		PressedMarkRead: ($) => derive({ ...$.model, sinceMs: null }, $.props.userId),
		ReceivedLiveEvent: ($, { messageId, event }) =>
			derive(
				{
					...$.model,
					live: {
						...$.model.live,
						[messageId]: reduceLive($.model.live[messageId] ?? initialLiveState, event),
					},
				},
				$.props.userId,
			),
		PressedRenderFullscreen: ($, { messageId, renderId }) =>
			$.evolve({ fullscreen: () => ({ messageId, renderId }) }),
		DismissedRenderFullscreen: ($) => $.evolve({ fullscreen: () => null }),
		CompletedCommand: ($) => $.model,
	},
	subscriptions: ({ props, model }) => {
		const messages = model.messages ?? []
		const threadIds = joined(messages.flatMap((message) => message.threadChannelId ?? []))
		const replyIds = joined(messages.flatMap((message) => message.replyToMessageId ?? []))
		return [
			Subscription.make("messages", [props.channelId], ([channelId]) =>
				messagesStream(ChannelId.make(channelId)),
			),
			// A page past the window is kept loading ahead, as today.
			Subscription.make("history", [props.channelId, model.limit + PAGE_SIZE], ([channelId, count]) =>
				historyStream(ChannelId.make(channelId), count),
			),
			Subscription.make("reactions", [props.channelId], ([channelId]) =>
				reactionsStream(ChannelId.make(channelId)),
			),
			Subscription.make("users", [], () => usersStream),
			Subscription.make("bots", [], () => botsStream),
			Subscription.make("attachments", [props.channelId, props.cdnUrl], ([channelId, cdnUrl]) =>
				attachmentsStream(ChannelId.make(channelId), cdnUrl),
			),
			Subscription.make("threadNames", [threadIds], ([ids]) =>
				threadNamesStream(ids === "" ? [] : ids.split(",").map((id) => ChannelId.make(id))),
			),
			Subscription.make("threadMessages", [threadIds], ([ids]) =>
				threadMessagesStream(ids === "" ? [] : ids.split(",").map((id) => ChannelId.make(id))),
			),
			Subscription.make("replyTargets", [props.channelId, replyIds], ([channelId, ids]) =>
				replyTargetsStream(
					ChannelId.make(channelId),
					ids === "" ? [] : ids.split(",").map((id) => MessageId.make(id)),
				),
			),
			Subscription.make("readPosition", [props.channelId, props.userId], ([channelId, userId]) =>
				readPositionStream(ChannelId.make(channelId), UserId.make(userId)),
			),
			Subscription.make("activity", [props.channelId], ([channelId]) =>
				activityStream(ChannelId.make(channelId)),
			),
			Subscription.make("clock", [], () => clockStream),
			// Only while a profile card is open, for whoever it shows.
			...(model.profile === null
				? []
				: [
						Subscription.make("profilePresence", [model.profile.userId], ([userId]) =>
							profilePresenceStream(UserId.make(userId)),
						),
					]),
			// One per streaming reply, so a reply joining or leaving the window leaves the others' sockets alone.
			...liveRepliesOf(model).map((reply) =>
				Subscription.make(
					`live-${reply.messageId}`,
					[reply.messageId, reply.channelId],
					([messageId, channelId]) =>
						liveStream({
							messageId: MessageId.make(messageId),
							channelId: ChannelId.make(channelId),
						}),
				),
			),
		]
	},
	view: (h, model) => {
		/** The row with its unfurled links' cards before its own, as today's URL embeds come first. */
		const rowData = (entry: RowEntry): Content.MessageRow => {
			if (entry.previews.length === 0) return entry.row
			const origin = h.props.linkPreviewUrl
			const cards = entry.previews.flatMap((request) => {
				const result =
					request._tag === "Link"
						? Option.getOrUndefined(h.queries.previews.get({ origin, url: request.url }))?.result
						: Option.getOrUndefined(
								h.queries.tweets.get({ origin, url: request.url, tweetId: request.tweetId }),
							)?.result
				const card = unfurlCardOf(request, result)
				return card === undefined ? [] : [card]
			})
			return rowWithCards(entry, cards)
		}

		/** One HTML render's frame: its signed URL as the query has it. */
		const frame = (messageId: MessageId, render: HtmlRenderRef, mode: "inline" | "fullscreen") => {
			const result = Option.getOrUndefined(
				h.queries.renders.get({ channelId: h.props.channelId, messageId, renderId: render.renderId }),
			)?.result
			return h
				.extension(HtmlRender, {
					src: result?._tag === "Success" ? result.value : null,
					title: render.title,
					height: render.height,
					failed: result?._tag === "Failure" && !result.waiting,
					mode,
				})
				.on("openLink", ({ url }) => MessageListMessage.PressedLink({ url }))
				.on("fullscreen", () =>
					MessageListMessage.PressedRenderFullscreen({ messageId, renderId: render.renderId }),
				)
				.on("leaveFullscreen", () => MessageListMessage.DismissedRenderFullscreen())
		}

		// HAZEL-GAP(p4-message-extension-slot): a `message` row has no slot for an extension, so a render is its own list child under the row; the web extension insets itself to the row's content column.
		const renders = (entry: RowEntry) =>
			entry.renders.map((render) =>
				h.stack
					.key(`${entry.key}:render:${render.renderId}`)
					.children(frame(entry.key, render, "inline")),
			)

		const row = (entry: RowEntry) =>
			h.message
				.key(entry.key)
				.row(rowData(entry))
				.grouped(entry.grouped)
				.pinned(entry.isPinned)
				.entering(entry.entering)
				.on("action", (payload) => MessageListMessage.PressedAction({ id: entry.key, ...payload }))
				.on("pressReaction", ({ emoji }) =>
					MessageListMessage.PressedReaction({ id: entry.key, emoji }),
				)
				// No `addReaction`: today's row has no add pill; the toolbar's react raises `action`.
				.on("pressAuthor", () => MessageListMessage.PressedAuthor({ id: entry.key }))
				.on("longPress", () => MessageListMessage.LongPressedMessage({ id: entry.key }))
				// The profile popover anchors at the pressed mention's run inside this row.
				.on("pressMention", ({ userId, run }) =>
					MessageListMessage.PressedMention({ id: entry.key, userId, run }),
				)
				.on("pressLink", ({ url }) => MessageListMessage.PressedLink({ url }))
				.on("pressAttachment", ({ id }) =>
					MessageListMessage.PressedAttachment({ id: entry.key, attachmentId: id }),
				)
				.on("pressReply", () => MessageListMessage.PressedReply({ id: entry.key }))
				.on("pressThread", () => MessageListMessage.PressedThread({ id: entry.key }))
				.on("retry", () => MessageListMessage.PressedRetry({ id: entry.key }))

		const entry = (item: Entry) =>
			Match.valueTags(item, {
				Date: ({ key, label }) => h.listDivider.key(key).label(label),
				Unread: ({ key }) => h.listDivider.key(key).kind("unread").label("New"),
				Row: (rowEntry) => row(rowEntry),
			})
		type Child = ReturnType<typeof entry> | ReturnType<typeof renders>[number]
		const children = (item: Entry): ReadonlyArray<Child> =>
			item._tag === "Row" ? [entry(item), ...renders(item)] : [entry(item)]

		const fresh =
			model.messages === null
				? null
				: newCountOf(model.messages, model.sinceMs, h.props.userId, hasOlder(model))
		// HAZEL-GAP(list-new-messages-bar): today's bar is a primary band with two halves; nearest is a muted frame.
		const bar =
			fresh === null || model.sinceMs === null
				? null
				: h.frame.surface("muted").children(
						h.stack
							.axis("horizontal")
							.align("center")
							.children(
								h.text
									.role("label")
									.children(
										`${fresh.count}${fresh.isAtLeast ? "+" : ""} ${fresh.count === 1 && !fresh.isAtLeast ? "new message" : "new messages"} since ${sinceLabel(model.sinceMs, model.nowMs)}`,
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
					)

		const list =
			model.messages === null || (model.messages.length > 0 && !windowReady(model))
				? h.list.loading()
				: model.messages.length === 0
					? h.emptyState.illustration("squirrel").title("Quiet as an ocean gazing squirrel...")
					: h.list
							.ref(ListRef)
							.anchor("end")
							.stickToBottom()
							.loadingStart(model.loadingOlder)
							.on("reachStart", MessageListMessage.ReachedStart())
							.on("reachEnd", MessageListMessage.ReachedEnd())
							.overlay(bar)
							.children(...model.entries.flatMap(children))

		const menuRow = model.menu === null ? undefined : rowOf(model, model.menu)
		const menuSheet = () =>
			h.sheet
				.open(menuRow !== undefined)
				.title("Message")
				.on("dismiss", MessageListMessage.DismissedMenu())
				.children(
					h.stack
						.axis("horizontal")
						.children(
							...(menuRow?.row.quick ?? []).map((emoji) =>
								h.button
									.key(`react:${emoji}`)
									.label(emoji)
									.variant("ghost")
									.on("press", MessageListMessage.PressedMenuReaction({ emoji })),
							),
						),
					h.frame
						.surface("flush")
						.children(
							...(menuRow?.row.actions ?? [])
								.filter((action) => !SHEET_SKIPS.includes(action))
								.map((action) =>
									h.item
										.key(action)
										.title(ACTION_LOOK[action].label)
										.leading(h.icon.name(ACTION_LOOK[action].icon))
										.on("press", MessageListMessage.PressedMenuAction({ action })),
								),
						),
				)

		const shown = model.fullscreen
		const shownRender =
			shown === null
				? undefined
				: rowOf(model, shown.messageId)?.renders.find((render) => render.renderId === shown.renderId)
		const fullscreenDialog = () =>
			h.dialog
				.open(shown !== null && shownRender !== undefined)
				.size("fullscreen")
				.title(shownRender?.title ?? "")
				.on("dismiss", MessageListMessage.DismissedRenderFullscreen())
				.children(
					...(shown === null || shownRender === undefined
						? []
						: [frame(shown.messageId, shownRender, "fullscreen")]),
				)

		const profile = model.profile
		const person = profile === null ? undefined : personOf(model, h.props.userId, profile.userId)
		return h.stack.children(
			list,
			h.popover
				.open(profile !== null)
				.anchorTo(profile === null ? undefined : { key: profile.id, run: profile.run })
				.on("dismiss", MessageListMessage.DismissedProfile())
				.children(
					person === undefined
						? null
						: ProfileCard(h, {
								person,
								presence: model.profilePresence,
								onEditProfile: MessageListMessage.PressedEditProfile(),
							}),
				),
			menuSheet(),
			fullscreenDialog(),
			EmojiPicker(h, {
				props: { open: model.picker !== null },
				onEmit: {
					Picked: ({ emoji }) => MessageListMessage.PickedReactionEmoji({ emoji }),
					RequestedClose: () => MessageListMessage.RequestedCloseEmojiPicker(),
				},
			}),
		)
	},
})
