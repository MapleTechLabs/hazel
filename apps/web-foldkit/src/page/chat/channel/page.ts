import type { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Effect, Record, Struct } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import * as HtmlRender from "../../../chat/html-render"
import * as Live from "../../../chat/live-state"
import * as Unfurl from "../../../chat/unfurl"
import * as Popover from "../../../ui/popover"
import * as MessageList from "../../../mount/message-list"
import { AppRoute } from "../../../route"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import {
	replyIdsOf,
	threadIdsOf,
	toDeriveContext,
	likeRowsOf,
	marginShiftsOf,
	toDisplayRows,
	toThreadRows,
	unfurlRequestsOf,
	isLiveReactionChange,
} from "../derive"
import { emptyLookups, type Lookups } from "../lookups"
import * as IssueControl from "../issue-control"
import * as Overlays from "../overlays"
import { PAGE_SIZE } from "../queries"
import {
	applyMessageChanges,
	type ChatMessage,
	shareIds,
	shareKeys,
	shareMessages,
	shareStickyKeys,
} from "../rows"
import type { ChannelHotkey } from "./hotkeys"
import { readOpenThread, stepNotifications, syncUnread, ToggleFollowThread } from "./clear-notifications"
import * as NewMessages from "./new-messages"
import * as NotificationClear from "./notification-clear"
import { DeleteMessageNow, FocusMessage } from "./message-keys"
import { type ChatTab, Message, type MessageKey, type Model, type PageReturn, Tab } from "./model"
import * as Jump from "./jump"
import { liftList, loadWhenNearEdge } from "./window"
import * as ThreadWidth from "./thread-width"
import * as Write from "./write"
import { FindUserDm } from "./user-dm"
import { errorToast, successToast } from "../../../data/actions"
import type { ComposerRequest } from "@hazel/shared-screens/chat/composer/host"
import { publish } from "../../../root/bus"

/** Channel page (`routes/_app/$orgSlug/chat/$id.tsx` + `$id/index.tsx`), read path. */

export { ChatTab, Message, Model, type PageReturn, Tab, type ThreadPanel } from "./model"
export { MAX_WINDOW } from "./window"

// INIT

export const listId = (channelId: string) => `message-list-${channelId}`

export interface InitOptions {
	readonly tab?: ChatTab
	/** What the previous channel's page hands on (`switchChannel`). */
	readonly carry?: {
		readonly viewportHeight: number
		readonly heightsByChannel: Model["heightsByChannel"]
		readonly threadPanelWidth: Model["threadPanelWidth"]
		readonly isWindowFocused: boolean
	}
}

export const init = (
	channelId: ChannelId,
	orgSlug: string,
	currentUserId: UserId | null,
	options: InitOptions = {},
): Model => ({
	channelId,
	tab: tabFor(options.tab ?? "messages", Tab.Messages()),
	orgSlug,
	currentUserId,
	channel: null,
	parentChannel: null,
	hasLoadedMessages: false,
	messages: [],
	reactions: [],
	hasLoadedReactions: false,
	lookups: emptyLookups,
	members: null,
	pinned: [],
	customer: null,
	issueRootIds: [],
	replyIds: [],
	threadIds: [],
	unfurls: {},
	liveStates: {},
	liveReplies: [],
	htmlRender: HtmlRender.init(),
	rows: [],
	limit: PAGE_SIZE,
	offset: 0,
	list: MessageList.init({
		id: listId(channelId),
		estimatedRowHeightPx: 80,
		viewportHeight: options.carry?.viewportHeight ?? 0,
		measuredHeights: options.carry?.heightsByChannel[channelId] ?? {},
	}),
	focusedMessageId: null,
	pendingJump: null,
	overlays: Overlays.init(),
	threadPanel: null,
	threadPanelWidth: options.carry?.threadPanelWidth ?? null,
	threadPanelDrag: null,
	notifications: NotificationClear.init({ isFocused: options.carry?.isWindowFocused ?? true }),
	newMessages: NewMessages.init(),
	heightsByChannel: Record.remove(options.carry?.heightsByChannel ?? {}, channelId),
})

/** How many channels' row heights the page remembers. */
export const REMEMBERED_CHANNELS = 20

/**
 * Another channel in the same org: a fresh page for it (nothing of the previous channel's state
 * survives: draft, thread panel, typing, overlays), seeded with the list's viewport and the heights
 * measured in this channel, so the switch frame already paints the new channel's rows.
 */
export const switchChannel = (
	model: Model,
	channelId: ChannelId,
	options: Omit<InitOptions, "carry">,
): Model => {
	const remembered = Object.entries({
		...Record.remove(model.heightsByChannel, model.channelId),
		[model.channelId]: model.list.measuredHeights,
	}).slice(-REMEMBERED_CHANNELS)
	const next = init(channelId, model.orgSlug, model.currentUserId, {
		...options,
		carry: {
			viewportHeight: model.list.viewportHeight,
			heightsByChannel: Object.fromEntries(remembered),
			threadPanelWidth: model.threadPanelWidth,
			isWindowFocused: model.notifications.isFocused,
		},
	})
	// The theme, users, presence and bots streams are not keyed by channel, so they keep running
	// across the switch without emitting again: the new page keeps what they last sent.
	return modifyFields(next, {
		htmlRender: (htmlRender) => modifyFields(htmlRender, { theme: () => model.htmlRender.theme }),
		lookups: (lookups) =>
			modifyFields(lookups, {
				users: () => model.lookups.users,
				presence: () => model.lookups.presence,
				bots: () => model.lookups.bots,
			}),
	})
}

/** The tab for a route: Messages keeps its instance; Files and All media are hazel pages. */
const tabFor = (routeTab: ChatTab, previous: Tab): Tab =>
	routeTab === "messages"
		? previous._tag === "Messages"
			? previous
			: Tab.Messages()
		: Tab.Files({ view: routeTab })

/** The route tab the page shows (what the tab bar highlights). */
export const routeTabOf = (tab: Tab): ChatTab => (tab._tag === "Messages" ? "messages" : tab.view)

/** The route moved between this channel's tabs. */
export const setTab = (model: Model, routeTab: ChatTab): Model =>
	routeTabOf(model.tab) === routeTab ? model : modifyFields(model, { tab: (tab) => tabFor(routeTab, tab) })

// ROUTES

const tabRoutes = {
	messages: AppRoute.ChatChannel,
	files: AppRoute.ChatFiles,
	media: AppRoute.ChatFilesMedia,
} as const

export const tabRoute = (orgSlug: string, channelId: ChannelId, tab: ChatTab): AppRoute =>
	tabRoutes[tab]({ orgSlug, channelId })

// UPDATE

/** The derive context with the page's unfurls, live states and HTML render frames. */
export const deriveContextOf = (
	model: Pick<Model, "lookups" | "currentUserId" | "unfurls" | "liveStates" | "htmlRender">,
) =>
	toDeriveContext(model.lookups, model.currentUserId ?? undefined, {
		unfurls: model.unfurls,
		liveStates: model.liveStates,
		htmlRenders: model.htmlRender,
		appearance: model.htmlRender.theme?.appearance ?? "dark",
	})

/** An HTML render step; rows re-derive when a frame's state or the appearance changed. */
const liftHtmlRender = (model: Model, message: HtmlRender.Message, nowMs: number): PageReturn => {
	const previous = model.htmlRender
	const result = HtmlRender.update(previous, message, nowMs)
	const next = result.model === previous ? model : modifyFields(model, { htmlRender: () => result.model })
	const commands = Command.mapMessages(result.commands ?? [], (inner) =>
		Message.GotHtmlRenderMessage({ message: inner }),
	)
	const isRowChange =
		result.model.urls !== previous.urls ||
		result.model.frames !== previous.frames ||
		result.model.theme?.appearance !== previous.theme?.appearance
	if (!isRowChange) return { model: next, commands }
	const derived = deriveRows(next)
	return { ...derived, commands: [...commands, ...(derived.commands ?? [])] }
}

const threadMessagesOf = (model: Model): ReadonlyArray<ChatMessage> => model.threadPanel?.messages ?? []

/**
 * What this page still draws rich content for: the thread panel's messages and its starter. The
 * channel's list is the hazel `MessageList`, which unfurls and streams its own.
 */
const panelMessagesOf = (model: Model): ReadonlyArray<ChatMessage> => {
	const panel = model.threadPanel
	if (panel === null) return []
	const starter = model.messages.find((message) => message.id === panel.messageId)
	return starter === undefined ? panel.messages : [starter, ...panel.messages]
}

/**
 * Starts the unfurl fetches the loaded messages need and marks them loading (legacy runs one atom
 * query per URL or tweet id, shared by every message that shows it).
 */
const requestUnfurls = (model: Model, messages: ReadonlyArray<ChatMessage>): PageReturn => {
	const pending: Record<string, Unfurl.Unfurl> = {}
	const commands: Array<Command.Command<Message>> = []
	for (const message of messages)
		for (const request of unfurlRequestsOf(message)) {
			if (request.key in model.unfurls || request.key in pending) continue
			pending[request.key] = Unfurl.loading
			const command: Command.Command<Unfurl.Message> =
				request.kind === "tweet"
					? Unfurl.FetchTweet({ tweetId: request.value })
					: Unfurl.FetchLinkPreview({ url: request.value })
			commands.push(
				...Command.mapMessages([command], (message) => Message.GotUnfurlMessage({ message })),
			)
		}
	return commands.length === 0
		? { model, commands }
		: { model: modifyFields(model, { unfurls: Struct.assign(pending) }), commands }
}

/** The thread panel's rows, re-derived from its messages and the page's lookups. */
const withThreadRows = (model: Model, isLiveReactions: boolean): Model => {
	const panel = model.threadPanel
	if (panel === null) return model
	const rows = toThreadRows(
		panel.messages,
		model.reactions,
		deriveContextOf(model),
		panel.rows,
		isLiveReactions,
	)
	return rows === panel.rows
		? model
		: modifyFields(model, { threadPanel: () => modifyFields(panel, { rows: () => rows }) })
}

/**
 * Re-derives the rows, then tells the list about the new keys so it can keep its anchor.
 * `isLiveReactions`: the reactions just changed live, so their pills animate the change.
 */
const deriveRows = (current: Model, isLiveReactions = false): PageReturn => {
	const requested = requestUnfurls(current, panelMessagesOf(current))
	const model = withThreadRows(requested.model, isLiveReactions)
	const rows = toDisplayRows(
		model.messages,
		model.reactions,
		deriveContextOf(model),
		model.rows,
		isLiveReactions,
		NewMessages.firstNewMessageId(model.newMessages, model.messages, model.currentUserId),
	)
	const threadRows = model.threadPanel?.rows ?? []
	const isShown = (messageId: MessageId) =>
		rows.some((row) => row.key === messageId) || threadRows.some((row) => row.key === messageId)
	const withRows = modifyFields(model, {
		rows: () => rows,
		overlays: (overlays) => Overlays.forgetMissingMessages(overlays, isShown),
		replyIds: (previous) => shareIds(previous, replyIdsOf(model.messages)),
		threadIds: (previous) => shareIds(previous, threadIdsOf(model.messages)),
	})
	const listed = liftList(
		withRows,
		MessageList.setKeys(
			withRows.list,
			shareKeys(withRows.list.keys, rows),
			shareStickyKeys(withRows.list.stickyKeys, rows),
			{
				likeRowsOf: (heights, previous) => likeRowsOf(rows, heights, previous),
				heightShifts: marginShiftsOf(model.rows, rows),
			},
		),
	)
	return { ...listed, commands: [...(requested.commands ?? []), ...(listed.commands ?? [])] }
}

/** The live replies, re-read only when the window's or the thread panel's messages change. */
const withLiveReplies = (model: Model): Model => {
	const liveReplies = Live.shareReplies(model.liveReplies, Live.connectedReplies(panelMessagesOf(model)))
	return liveReplies === model.liveReplies ? model : modifyFields(model, { liveReplies: () => liveReplies })
}

const withLookup = <K extends keyof Lookups>(model: Model, key: K, value: Lookups[K]): PageReturn =>
	deriveRows(modifyFields(model, { lookups: (lookups) => ({ ...lookups, [key]: value }) }))

const liftOverlays = (model: Model, result: Overlays.OverlaysReturn): PageReturn => {
	const next =
		result.model === model.overlays ? model : modifyFields(model, { overlays: () => result.model })
	const lifted: PageReturn = {
		model: next,
		commands: Command.mapMessages(result.commands ?? [], (message) =>
			Message.GotOverlaysMessage({ message }),
		),
	}
	return result.outMessage === undefined
		? lifted
		: Write.andThen(lifted, (current) => Write.handleOverlaysOut(current, result.outMessage!))
}

/** The pins shortcut, for the shared channel header's pins (they own the popover now). */
const PublishPinsHotkey = Command.define("PublishPinsHotkey", {
	messages: [Message.CompletedPublishPinsHotkey],
	execute: Effect.sync(() => publish({ _tag: "PinsHotkey" })).pipe(
		Effect.as(Message.CompletedPublishPinsHotkey()),
	),
})

/**
 * What a channel shortcut does. The pickers, the file picker and the pins are what their buttons send
 * (the emoji and GIF pickers and files go to the composer the keyboard is in: the thread's while one
 * is open); the page keys scroll the messages; Escape marks the channel read.
 */
const pressedChannelHotkey = (model: Model, action: ChannelHotkey): PageReturn => {
	const ask = (request: ComposerRequest) => Write.askComposer(model, Write.focusedComposer(model), request)
	switch (action) {
		case "EmojiPicker":
			return ask({ _tag: "OpenEmojiPicker" })
		case "GifPicker":
			return ask({ _tag: "OpenGifPicker" })
		case "Upload":
			return ask({ _tag: "Attach" })
		case "Pins":
			return { model, commands: [PublishPinsHotkey()] }
		case "ScrollUp":
			return loadWhenNearEdge(liftList(model, MessageList.scrollByPage(model.list, "Up")))
		case "ScrollDown":
			return loadWhenNearEdge(liftList(model, MessageList.scrollByPage(model.list, "Down")))
		case "MarkRead":
			return markRead(model)
	}
}

// NEW MESSAGES

/** `newMessages` changed: the "New" line moves, so the rows re-derive when it did. */
const withNewMessages = (model: Model, next: NewMessages.Model): PageReturn =>
	next === model.newMessages
		? { model }
		: next.sinceMs === model.newMessages.sinceMs
			? { model: modifyFields(model, { newMessages: () => next }) }
			: deriveRows(modifyFields(model, { newMessages: () => next }))

/**
 * The read position is captured once both its queries have answered; the clear machine waits for
 * that before its first clear, then sees what there is to read.
 */
const syncNewMessages = (model: Model): PageReturn => {
	const wasCaptured = model.newMessages.isCaptured
	const captured = withNewMessages(model, NewMessages.capture(model.newMessages, model.currentUserId))
	const released =
		!wasCaptured && captured.model.newMessages.isCaptured
			? stepNotifications(captured.model, { _tag: "Captured" })
			: { model: captured.model }
	const synced = syncUnread(released.model)
	return {
		...synced,
		commands: [...(captured.commands ?? []), ...(released.commands ?? []), ...(synced.commands ?? [])],
	}
}

/** Escape, or the bar's "Mark as read": the channel is read now and the "New" line goes. */
const markRead = (model: Model): PageReturn => {
	const dismissed = withNewMessages(model, NewMessages.dismiss(model.newMessages))
	const stepped = stepNotifications(dismissed.model, { _tag: "MarkedRead" })
	return { ...stepped, commands: [...(dismissed.commands ?? []), ...(stepped.commands ?? [])] }
}

/** The bar's "Jump": to the oldest loaded new message; the bar goes, the line stays. */
const jumpToNew = (model: Model): PageReturn => {
	const messageId = NewMessages.firstNewMessageId(model.newMessages, model.messages, model.currentUserId)
	const dismissed = modifyFields(model, { newMessages: NewMessages.dismissBar })
	return messageId === null ? { model: dismissed } : Jump.toMessage(dismissed, messageId, messageId)
}

// MESSAGE KEYBOARD

/** The list's messages, oldest first (date dividers left out). */
const messageIdsOf = (model: Model): ReadonlyArray<MessageId> =>
	model.rows.flatMap((row) => (row._tag === "MessageRow" ? [row.message.id] : []))

/** Scrolls a message into view and moves the keyboard onto it. */
const focusMessage = (model: Model, messageId: MessageId): PageReturn => {
	const revealed = loadWhenNearEdge(
		liftList(
			modifyFields(model, { focusedMessageId: () => messageId }),
			MessageList.revealRow(model.list, messageId),
		),
	)
	return { ...revealed, commands: [...(revealed.commands ?? []), FocusMessage({ messageId })] }
}

/** Shift+Tab from the composer: back to the message the keyboard was last on, else the newest. */
const focusMessages = (model: Model): PageReturn => {
	const ids = messageIdsOf(model)
	const target =
		model.focusedMessageId !== null && ids.includes(model.focusedMessageId)
			? model.focusedMessageId
			: ids.at(-1)
	return target === undefined ? { model } : focusMessage(model, target)
}

/** A key on a focused message: what Discord does with it, through the message's own actions. */
const pressedMessageKey = (model: Model, messageId: MessageId, key: MessageKey): PageReturn => {
	const facts = factsOf(model)
	const isOwn = facts.isOwnMessage(messageId)
	const act = (action: Overlays.MessageAction) =>
		Write.handleOverlaysOut(model, Overlays.OutMessage.RequestedMessageAction({ messageId, action }))
	const ids = messageIdsOf(model)
	const index = ids.indexOf(messageId)
	switch (key) {
		case "Previous":
			return index > 0 ? focusMessage(model, ids[index - 1]!) : { model }
		case "Next":
			// Past the newest message the keyboard returns to the composer, as in Discord.
			return index >= 0 && index < ids.length - 1
				? focusMessage(model, ids[index + 1]!)
				: Write.focusComposer(model)
		case "BackToComposer":
			return Write.focusComposer(model)
		case "Edit":
			return isOwn ? act("edit") : { model }
		case "Reply":
			return Write.andThen(act("reply"), Write.focusComposer)
		case "Thread":
			return facts.canStartThread(messageId) ? act("thread") : { model }
		case "Pin":
			return act("pin")
		case "Delete":
			return isOwn ? act("delete") : { model }
		case "DeleteNow":
			return isOwn ? { model, commands: [DeleteMessageNow({ messageId })] } : { model }
		case "React":
			return act("add-reaction")
		case "Copy":
			return act("copy")
	}
}

export const update = (model: Model, message: Message, shared: Shared | null = null): PageReturn =>
	Message.match<PageReturn>(message, {
		UpdatedChannel: ({ channelId, channel }) =>
			channelId === model.channelId
				? { model: modifyFields(model, { channel: () => channel }) }
				: { model },
		ClickedTab: ({ tab }) =>
			tab === routeTabOf(model.tab)
				? { model }
				: {
						model,
						outMessage: PageOutMessage.RequestedNavigation({
							route: tabRoute(model.orgSlug, model.channelId, tab),
							replace: false,
						}),
					},
		UpdatedParentChannel: ({ channel }) => ({
			model: modifyFields(model, { parentChannel: () => channel }),
		}),
		ChangedMessages: ({ channelId, order, upserts }) =>
			channelId !== model.channelId
				? { model }
				: Jump.resume(
						deriveRows(
							withLiveReplies(
								modifyFields(model, {
									hasLoadedMessages: () => true,
									messages: (previous) => applyMessageChanges(previous, order, upserts),
								}),
							),
						),
					),
		UpdatedReactions: ({ channelId, reactions }) =>
			channelId === model.channelId
				? deriveRows(
						modifyFields(model, {
							reactions: () => reactions,
							hasLoadedReactions: () => true,
						}),
						// The first result (and a re-subscribe's burst) is a load, not someone reacting.
						model.hasLoadedReactions && isLiveReactionChange(model.reactions, reactions),
					)
				: { model },
		UpdatedUsers: ({ users }) => withLookup(model, "users", users),
		UpdatedPresence: ({ presence }) => withLookup(model, "presence", presence),
		UpdatedBots: ({ bots }) => withLookup(model, "bots", bots),
		UpdatedCustomEmojis: ({ customEmojis }) => withLookup(model, "customEmojis", customEmojis),
		UpdatedUserGroups: ({ groups }) => withLookup(model, "userGroups", groups),
		// A late result from the channel just left must not replace the new channel's lookups.
		UpdatedAttachments: ({ channelId, attachments }) =>
			channelId === model.channelId ? withLookup(model, "attachments", attachments) : { model },
		UpdatedSyncedMessages: ({ channelId, messages }) =>
			channelId === model.channelId ? withLookup(model, "syncedMessages", messages) : { model },
		UpdatedAgentMarks: ({ channelId, marks }) =>
			channelId === model.channelId ? withLookup(model, "agentMarks", marks) : { model },
		UpdatedCustomerAuthors: ({ channelId, authors }) =>
			channelId === model.channelId ? withLookup(model, "customerAuthors", authors) : { model },
		UpdatedSyncProvider: ({ provider }) =>
			provider === model.lookups.syncProvider ? { model } : withLookup(model, "syncProvider", provider),
		UpdatedThreadChannels: ({ channels }) => withLookup(model, "threadChannels", channels),
		UpdatedThreadMessages: ({ messages }) => withLookup(model, "threadMessages", messages),
		UpdatedReplyTargets: ({ targets }) => withLookup(model, "replyTargets", targets),
		UpdatedMembers: ({ members }) => syncUnread(modifyFields(model, { members: () => members })),
		UpdatedActivity: ({ channelId, activity }) =>
			channelId !== model.channelId
				? { model }
				: syncNewMessages(
						modifyFields(model, {
							newMessages: (newMessages) =>
								modifyFields(newMessages, {
									activity: () => activity,
									hasActivity: () => true,
								}),
						}),
					),
		UpdatedReadPosition: ({ channelId, readUpToMs }) =>
			channelId !== model.channelId
				? { model }
				: syncNewMessages(
						modifyFields(model, {
							newMessages: (newMessages) =>
								modifyFields(newMessages, {
									readUpToMs: () => readUpToMs,
									hasReadPosition: () => true,
								}),
						}),
					),
		ClickedJumpToNew: () => jumpToNew(model),
		ClickedMarkNewRead: () => markRead(model),
		// Focus back: the open thread's replies that came while away are read too.
		ChangedWindowFocus: ({ isFocused }) =>
			Write.andThen(stepNotifications(model, { _tag: "ChangedFocus", isFocused }), readOpenThread),
		UpdatedPinned: ({ pins }) => ({ model: modifyFields(model, { pinned: () => pins }) }),
		UpdatedCustomer: ({ channelId, customer }) => ({
			model: channelId !== model.channelId ? model : modifyFields(model, { customer: () => customer }),
		}),
		UpdatedIssueRoots: ({ channelId, rootMessageIds }) => ({
			model:
				channelId === model.channelId
					? modifyFields(model, { issueRootIds: (previous) => shareIds(previous, rootMessageIds) })
					: model,
		}),
		GotIssueControlMessage: ({ message: issueMessage }) => liftIssueControl(model, issueMessage),
		// A result for a thread the panel no longer shows is dropped.
		UpdatedThreadPanelMessages: ({ threadChannelId, messages }) => {
			const panel = model.threadPanel
			if (panel === null || panel.threadChannelId !== threadChannelId) return { model }
			const withMessages = withLiveReplies(
				modifyFields(model, {
					threadPanel: () =>
						modifyFields(panel, { messages: (previous) => shareMessages(previous, messages) }),
				}),
			)
			const requested = requestUnfurls(withMessages, messages)
			const read = readOpenThread(withThreadRows(requested.model, false))
			return { model: read.model, commands: [...(requested.commands ?? []), ...(read.commands ?? [])] }
		},
		UpdatedThreadPanelPins: ({ threadChannelId, pins }) =>
			model.threadPanel?.threadChannelId === threadChannelId
				? {
						model: modifyFields(model, {
							threadPanel: (panel) =>
								panel === null ? null : modifyFields(panel, { pins: () => pins }),
						}),
					}
				: { model },
		GotUnfurlMessage: ({ message: unfurlMessage }) =>
			deriveRows(
				modifyFields(model, { unfurls: (unfurls) => Unfurl.applyMessage(unfurls, unfurlMessage) }),
			),
		GotLiveMessage: ({ message: liveMessage }) =>
			deriveRows(
				modifyFields(model, { liveStates: (states) => Live.applyMessage(states, liveMessage) }),
			),
		// Without the shared clock the fullscreen check treats every URL as expiring.
		GotHtmlRenderMessage: ({ message: htmlRenderMessage }) => {
			const result = liftHtmlRender(model, htmlRenderMessage, shared?.nowMs ?? Number.MAX_SAFE_INTEGER)
			if (htmlRenderMessage._tag !== "PointerLeftFrame") return result
			// The list saw no pointer events while the pointer was over the frame: it left the message too.
			const left = liftOverlays(
				result.model,
				Overlays.update(result.model.overlays, Overlays.Message.PointerLeftList()),
			)
			return { ...left, commands: [...(result.commands ?? []), ...(left.commands ?? [])] }
		},
		GotListMessage: ({ message: listMessage }) =>
			loadWhenNearEdge(liftList(model, MessageList.update(model.list, listMessage))),
		GotOverlaysMessage: ({ message: overlaysMessage }) =>
			liftOverlays(model, Overlays.update(model.overlays, overlaysMessage)),
		// Shift+Tab out of the channel's composer moves to the messages; a send dismisses the "New"
		// line, so the rows re-derive without it.
		ReceivedComposerNotice: ({ notice }) =>
			notice._tag === "Left"
				? notice.channelId === model.channelId
					? focusMessages(model)
					: { model }
				: Write.andThen(Write.composerNotice(model, notice), (next) =>
						next.newMessages.sinceMs === model.newMessages.sinceMs
							? { model: next }
							: deriveRows(next),
					),
		CompletedRequestComposer: () => ({ model }),
		GotActionMessage: ({ message: actionMessage }) => Write.handleActionMessage(model, actionMessage),
		// The membership can land after the thread's messages: a followed thread is read then.
		UpdatedThreadMember: ({ threadChannelId, memberId }) =>
			model.threadPanel?.threadChannelId === threadChannelId
				? readOpenThread(
						modifyFields(model, {
							threadPanel: (panel) =>
								panel === null ? null : modifyFields(panel, { memberId: () => memberId }),
						}),
					)
				: { model },
		ClickedThreadPreview: ({ threadChannelId, messageId }) =>
			Write.openThread(model, threadChannelId, messageId, "Created"),
		ClickedEditProfile: () => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({
				route: AppRoute.MySettingsProfile({ orgSlug: model.orgSlug }),
				replace: false,
			}),
		}),
		ClickedMessageUser: ({ userId, viewerId, name }) => {
			const organizationId = model.channel?.organizationId
			return organizationId === undefined
				? { model }
				: {
						model,
						commands: [
							FindUserDm({
								fromChannelId: model.channelId,
								organizationId,
								viewerId,
								userId,
								name,
							}),
						],
					}
		},
		FoundUserDm: ({ fromChannelId, organizationId, userId, name, channelId }) => {
			if (fromChannelId !== model.channelId) return { model }
			return {
				model,
				outMessage:
					channelId === null
						? PageOutMessage.RequestedDmCreation({
								organizationId,
								orgSlug: model.orgSlug,
								userId,
								name,
							})
						: PageOutMessage.RequestedNavigation({
								route: AppRoute.ChatChannel({ orgSlug: model.orgSlug, channelId }),
								replace: false,
							}),
			}
		},
		ClickedViewProfile: ({ userId }) => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({
				route: AppRoute.Profile({ orgSlug: model.orgSlug, userId }),
				replace: false,
			}),
		}),
		// The composer's own mention markup, as picking the person from `@` writes it.
		ClickedMentionUser: ({ userId }) => Write.insertGlobalText(model, `@[userId:${userId}] `),
		ClickedCopyProfileField: ({ field, text }) =>
			Write.copy(model, text, field === "email" ? "Email" : "UserId"),
		ClickedReplyPreview: ({ fromMessageId, messageId }) =>
			Jump.toMessage(model, fromMessageId, messageId),
		LocatedJumpTarget: ({ messageId, newerCount }) => Jump.located(model, messageId, newerCount),
		FailedLocateJumpTarget: ({ messageId }) =>
			model.pendingJump?.messageId === messageId
				? Write.withToast(
						modifyFields(model, { pendingJump: () => null }),
						Write.messageNotFoundToast("MessageNotFound"),
					)
				: { model },
		RenderedJumpTarget: ({ messageId }) => Jump.rendered(model, messageId),
		CompletedHighlightMessage: () => ({ model }),
		ClickedEmbedAction: ({ channelId, messageId, actionId }) =>
			Write.pressEmbedAction(model, { channelId, messageId, actionId }),
		ClickedCloseThread: () => Write.closeThread(model),
		ClickedGenerateThreadName: () => Write.generateThreadName(model),
		ClickedToggleFollowThread: () => {
			const panel = model.threadPanel
			if (panel === null || panel.creation !== "Created") return { model }
			return {
				model,
				commands: [
					ToggleFollowThread({
						threadChannelId: panel.threadChannelId,
						memberId: panel.memberId,
					}),
				],
			}
		},
		CompletedToggleFollowThread: ({ isFollowing, isSuccess }) =>
			Write.withToast(
				model,
				isSuccess
					? successToast(isFollowing ? "Following thread" : "Unfollowed thread")
					: errorToast(isFollowing ? "Couldn't follow the thread" : "Couldn't unfollow the thread"),
			),
		ClickedRenameThread: () =>
			model.threadPanel === null
				? { model }
				: {
						model,
						outMessage: PageOutMessage.RequestedModal({
							modal: { _tag: "RenameThread", threadId: model.threadPanel.threadChannelId },
						}),
					},
		PressedThreadPanelEdge: ({ clientX, startWidth, maxWidth }) =>
			ThreadWidth.pressEdge(model, clientX, startWidth, maxWidth),
		MovedThreadPanelEdge: ({ clientX }) => ThreadWidth.moveEdge(model, clientX),
		ReleasedThreadPanelEdge: () => ThreadWidth.releaseEdge(model),
		PressedThreadPanelEdgeKey: ({ delta }) => ThreadWidth.nudgeEdge(model, delta),
		LoadedThreadPanelWidth: ({ width }) => ThreadWidth.loadedWidth(model, width),
		CompletedSaveThreadPanelWidth: () => ({ model }),
		PressedGlobalKey: ({ key }) => Write.insertGlobalText(model, key),
		PastedGlobalFiles: ({ files }) => Write.pasteGlobalFiles(model, files),
		PastedGlobalText: ({ text }) => Write.insertGlobalText(model, text),
		PressedChannelHotkey: ({ action }) => pressedChannelHotkey(model, action),
		PressedMessageKey: ({ messageId, key }) => pressedMessageKey(model, messageId, key),
		FocusedMessage: ({ messageId }) =>
			model.focusedMessageId === messageId
				? { model }
				: { model: modifyFields(model, { focusedMessageId: () => messageId }) },
		CompletedFocusMessage: () => ({ model }),
		CompletedPublishPinsHotkey: () => ({ model }),
		StartedMessageKeys: () => ({ model }),
		SucceededDeleteMessageNow: () => ({ model }),
		FailedDeleteMessageNow: ({ reason }) => Write.withToast(model, Write.messageNotFoundToast(reason)),
		// A result for the channel the page has since switched away from is dropped.
		CompletedReadThread: () => ({ model }),
		SucceededClearNotifications: ({ channelId }) =>
			channelId === model.channelId ? stepNotifications(model, { _tag: "Succeeded" }) : { model },
		// Best effort, like legacy: no toast; the machine retries after a backoff.
		FailedClearNotifications: ({ channelId, reason }) =>
			channelId === model.channelId
				? stepNotifications(model, { _tag: "Failed", isChannelGone: reason === "ChannelNotFound" })
				: { model },
		ElapsedClearNotificationsRetry: ({ channelId }) =>
			channelId === model.channelId ? stepNotifications(model, { _tag: "ElapsedRetry" }) : { model },
	})

/** A step of the thread panel's issue control; an issue for a thread no longer shown is dropped. */
const liftIssueControl = (model: Model, message: IssueControl.Message): PageReturn => {
	const panel = model.threadPanel
	if (panel === null) return { model }
	if (message._tag === "UpdatedIssue" && message.rootMessageId !== panel.messageId) return { model }
	const result = IssueControl.update(panel.issue, message, {
		organizationId: model.channel?.organizationId ?? null,
		currentUserId: model.currentUserId,
	})
	const next =
		result.model === panel.issue
			? model
			: modifyFields(model, { threadPanel: () => modifyFields(panel, { issue: () => result.model }) })
	const lifted: PageReturn = {
		model: next,
		commands: Command.mapMessages(result.commands ?? [], (inner) =>
			Message.GotIssueControlMessage({ message: inner }),
		),
	}
	const out = result.outMessage
	if (out === undefined) return lifted
	return Write.andThen(lifted, (current) =>
		IssueControl.OutMessage.match<PageReturn>(out, {
			RequestedCreateIssue: () => Write.createIssue(current, panel.messageId),
			RequestedToast: ({ toast }) => Write.withToast(current, toast),
		}),
	)
}

/** Message facts the overlays read when a menu opens. */
export const factsOf = (model: Model): Overlays.MessageFacts => {
	// The channel's messages and the open thread panel's replies: both take the same actions.
	const find = (messageId: MessageId) =>
		model.messages.find((message) => message.id === messageId) ??
		model.threadPanel?.messages.find((message) => message.id === messageId)
	const canStartThread = (messageId: MessageId) =>
		canStartThreadIn(model.channel?.type ?? null, model.channelId, find(messageId)?.channelId ?? null)
	return {
		isOwnMessage: (messageId) => find(messageId)?.authorId === model.currentUserId,
		isPinned: (messageId) => find(messageId)?.isPinned ?? false,
		canStartThread,
		// A top-level message of a linked channel that has no issue yet (as far as the client knows).
		canCreateIssue: (messageId) =>
			model.customer !== null && canStartThread(messageId) && !model.issueRootIds.includes(messageId),
	}
}

/** Threads start from a channel's own messages: not inside a thread, nor from a thread panel's reply. */
export const canStartThreadIn = (
	channelType: string | null,
	channelId: ChannelId,
	messageChannelId: ChannelId | null,
): boolean => channelType !== "thread" && messageChannelId === channelId

/** The signed-in user arrived after the page was created (reactions need it for `hasReacted`). */
export const setCurrentUserId = (model: Model, currentUserId: UserId | null): PageReturn =>
	model.currentUserId === currentUserId
		? { model }
		: deriveRows(modifyFields(model, { currentUserId: () => currentUserId }))

/**
 * `useIsChannelMember`: unknown until the members query has answered. A thread has no join step:
 * its access is the parent channel's, so anyone who can open it counts as a member.
 */
export const isMemberOf = (model: Model): boolean | null =>
	model.channel?.type === "thread"
		? true
		: model.members === null || model.currentUserId === null
			? null
			: model.members.some((member) => member.userId === model.currentUserId)
