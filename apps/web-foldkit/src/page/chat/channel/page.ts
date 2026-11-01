import type { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Record, Struct } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import * as HtmlRender from "../../../chat/html-render"
import * as Live from "../../../chat/live-state"
import * as Unfurl from "../../../chat/unfurl"
import * as Composer from "../../../composer/composer"
import * as Draft from "../../../composer/draft"
import * as MessageList from "../../../mount/message-list"
import { AppRoute } from "../../../route"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import {
	replyIdsOf,
	threadIdsOf,
	toDeriveContext,
	toDisplayRows,
	toThreadRows,
	unfurlRequestsOf,
} from "../derive"
import { typingNamesOf, typingUsersOf } from "../banners"
import { emptyLookups, type Lookups } from "../lookups"
import * as FilesPage from "../files/page"
import { JoinChannel } from "../message-actions"
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
import { type ChatTab, Message, type Model, type PageReturn, Tab } from "./model"
import { loadWhenNearEdge } from "./window"
import * as ThreadWidth from "./thread-width"
import * as Write from "./write"

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
	}
}

export const init = (
	channelId: ChannelId,
	orgSlug: string,
	currentUserId: UserId | null,
	options: InitOptions = {},
): Model => ({
	channelId,
	tab: tabFor(channelId, orgSlug, options.tab ?? "messages", Tab.Messages()),
	orgSlug,
	currentUserId,
	channel: null,
	parentChannel: null,
	hasLoadedMessages: false,
	messages: [],
	reactions: [],
	lookups: emptyLookups,
	members: null,
	pinned: [],
	typing: [],
	typingNowMs: 0,
	typingNames: [],
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
	overlays: Overlays.init(),
	draft: Draft.init(channelId, composerEditorId(channelId)),
	threadPanel: null,
	threadPanelWidth: options.carry?.threadPanelWidth ?? null,
	threadPanelDrag: null,
	notificationsClear: "NotSent",
	isJoining: false,
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
		},
	})
	// The theme stream keeps running across the switch, so the new page keeps the theme it read.
	return modifyFields(next, {
		htmlRender: (htmlRender) => modifyFields(htmlRender, { theme: () => model.htmlRender.theme }),
	})
}

export const composerEditorId = (channelId: string) => `composer-${channelId}`

/** The tab for a route: the Files Submodel is kept across `files` and `files/media`, dropped on Messages. */
const tabFor = (channelId: ChannelId, orgSlug: string, routeTab: ChatTab, previous: Tab): Tab =>
	routeTab === "messages"
		? previous._tag === "Messages"
			? previous
			: Tab.Messages()
		: Tab.Files({
				files:
					previous._tag === "Files"
						? FilesPage.setView(previous.files, routeTab)
						: FilesPage.init(channelId, orgSlug, routeTab),
			})

/** The route tab the page shows (what the tab bar highlights). */
export const routeTabOf = (tab: Tab): ChatTab => (tab._tag === "Messages" ? "messages" : tab.files.view)

/** The route moved between this channel's tabs. */
export const setTab = (model: Model, routeTab: ChatTab): Model =>
	routeTabOf(model.tab) === routeTab
		? model
		: modifyFields(model, { tab: (tab) => tabFor(model.channelId, model.orgSlug, routeTab, tab) })

// ROUTES

const tabRoutes = {
	messages: AppRoute.ChatChannel,
	files: AppRoute.ChatFiles,
	media: AppRoute.ChatFilesMedia,
} as const

export const tabRoute = (orgSlug: string, channelId: ChannelId, tab: ChatTab): AppRoute =>
	tabRoutes[tab]({ orgSlug, channelId })

// UPDATE

const liftList = (model: Model, result: MessageList.ListReturn): PageReturn => ({
	// An unchanged list keeps the page reference, so ignored events cost no render.
	model: result.model === model.list ? model : modifyFields(model, { list: () => result.model }),
	commands: Command.mapMessages(result.commands, (message) => Message.GotListMessage({ message })),
})

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
const withThreadRows = (model: Model): Model => {
	const panel = model.threadPanel
	if (panel === null) return model
	const rows = toThreadRows(panel.messages, deriveContextOf(model), panel.rows)
	return rows === panel.rows
		? model
		: modifyFields(model, { threadPanel: () => modifyFields(panel, { rows: () => rows }) })
}

/** Re-derives the rows, then tells the list about the new keys so it can keep its anchor. */
const deriveRows = (current: Model): PageReturn => {
	const requested = requestUnfurls(current, [...current.messages, ...threadMessagesOf(current)])
	const model = withThreadRows(requested.model)
	const rows = toDisplayRows(model.messages, model.reactions, deriveContextOf(model), model.rows)
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
		),
	)
	return { ...listed, commands: [...(requested.commands ?? []), ...(listed.commands ?? [])] }
}

/** The live replies, re-read only when the window's or the thread panel's messages change. */
const withLiveReplies = (model: Model): Model => {
	const liveReplies = Live.shareReplies(
		model.liveReplies,
		Live.connectedReplies([...model.messages, ...threadMessagesOf(model)]),
	)
	return liveReplies === model.liveReplies ? model : modifyFields(model, { liveReplies: () => liveReplies })
}

/** Who is typing, re-read when the indicators, members, users or the clock change. */
const withTypingNames = (model: Model): Model => {
	const typingNames = typingNamesOf(
		model.typingNames,
		typingUsersOf(
			model.typing,
			model.members,
			model.lookups.users,
			model.currentUserId,
			model.typingNowMs,
		),
	)
	return typingNames === model.typingNames ? model : modifyFields(model, { typingNames: () => typingNames })
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

const liftFiles = (model: Model, result: FilesPage.FilesReturn): PageReturn => {
	const lifted: PageReturn = {
		model: modifyFields(model, { tab: () => Tab.Files({ files: result.model }) }),
		commands: Command.mapMessages(result.commands ?? [], (message) =>
			Message.GotFilesMessage({ message }),
		),
	}
	return result.outMessage === undefined
		? lifted
		: Write.andThen(lifted, (current) =>
				FilesPage.OutMessage.match<PageReturn>(result.outMessage!, {
					RequestedViewerAction: ({ action, url, fileName }) =>
						Write.viewerAction(current, action, url, fileName),
				}),
			)
}

/** `ChannelJoinBanner`'s `handleJoin`. */
const joinChannel = (model: Model): PageReturn =>
	model.isJoining || model.currentUserId === null
		? { model }
		: {
				model: modifyFields(model, { isJoining: () => true }),
				commands: Write.actionCommands([
					JoinChannel({ channelId: model.channelId, userId: model.currentUserId }),
				]),
			}

export const update = (model: Model, message: Message, shared: Shared | null = null): PageReturn =>
	Message.match<PageReturn>(message, {
		UpdatedChannel: ({ channel }) => ({ model: modifyFields(model, { channel: () => channel }) }),
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
		ClickedMobileMenu: () => ({ model, outMessage: PageOutMessage.RequestedMobileSidebar() }),
		UpdatedParentChannel: ({ channel }) => ({
			model: modifyFields(model, { parentChannel: () => channel }),
		}),
		ChangedMessages: ({ order, upserts }) =>
			deriveRows(
				withLiveReplies(
					modifyFields(model, {
						hasLoadedMessages: () => true,
						messages: (previous) => applyMessageChanges(previous, order, upserts),
					}),
				),
			),
		UpdatedReactions: ({ reactions }) => deriveRows(modifyFields(model, { reactions: () => reactions })),
		UpdatedUsers: ({ users }) => {
			const result = withLookup(model, "users", users)
			return { ...result, model: withTypingNames(result.model) }
		},
		UpdatedPresence: ({ presence }) =>
			Write.andThen(withLookup(model, "presence", presence), (next) =>
				Write.forwardComposerData(
					next,
					Composer.Message.UpdatedPresence({ presence: Write.toComposerPresence(presence) }),
				),
			),
		UpdatedBots: ({ bots }) => withLookup(model, "bots", bots),
		UpdatedCustomEmojis: ({ customEmojis }) =>
			Write.andThen(withLookup(model, "customEmojis", customEmojis), (next) =>
				Write.forwardComposerData(
					next,
					Composer.Message.UpdatedCustomEmojis({ emojis: customEmojis }),
				),
			),
		UpdatedAttachments: ({ attachments }) => withLookup(model, "attachments", attachments),
		UpdatedDiscordSynced: ({ messageIds }) => withLookup(model, "discordSyncedIds", messageIds),
		UpdatedThreadChannels: ({ channels }) => withLookup(model, "threadChannels", channels),
		UpdatedThreadMessages: ({ messages }) => withLookup(model, "threadMessages", messages),
		UpdatedReplyTargets: ({ targets }) => withLookup(model, "replyTargets", targets),
		UpdatedMembers: ({ members }) => ({
			model: withTypingNames(modifyFields(model, { members: () => members })),
		}),
		UpdatedPinned: ({ pins }) => ({ model: modifyFields(model, { pinned: () => pins }) }),
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
			return { ...requested, model: withThreadRows(requested.model) }
		},
		UpdatedTyping: ({ typing }) => ({
			model: withTypingNames(modifyFields(model, { typing: () => typing })),
		}),
		TickedTypingClock: ({ nowMs }) => ({
			model: withTypingNames(modifyFields(model, { typingNowMs: () => nowMs })),
		}),
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
		GotDraftMessage: ({ message: draftMessage }) =>
			Write.updateDraft(model, "channel", draftMessage, shared),
		GotThreadDraftMessage: ({ message: draftMessage }) =>
			Write.updateDraft(model, "thread", draftMessage, shared),
		GotActionMessage: ({ message: actionMessage }) => Write.handleActionMessage(model, actionMessage),
		UpdatedThreadMember: ({ threadChannelId, memberId }) =>
			model.threadPanel?.threadChannelId === threadChannelId
				? {
						model: modifyFields(model, {
							threadPanel: (panel) =>
								panel === null ? null : modifyFields(panel, { memberId: () => memberId }),
						}),
					}
				: { model },
		ClickedThreadPreview: ({ threadChannelId, messageId }) =>
			Write.openThread(model, threadChannelId, messageId, "Created"),
		ClickedEmbedAction: ({ channelId, messageId, actionId }) =>
			Write.pressEmbedAction(model, { channelId, messageId, actionId }),
		ClickedCloseThread: () => Write.closeThread(model),
		ClickedGenerateThreadName: () => Write.generateThreadName(model),
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
		ClickedJoinChannel: () => joinChannel(model),
		PressedGlobalKey: ({ key }) => Write.insertGlobalKey(model, key),
		LeftWindow: () =>
			Write.andThen(Write.updateDraft(model, "channel", Draft.Message.LeftWindow(), shared), (next) =>
				Write.updateDraft(next, "thread", Draft.Message.LeftWindow(), shared),
			),
		// A result for the channel the page has since switched away from is dropped.
		SucceededClearNotifications: ({ channelId }) =>
			channelId === model.channelId
				? { model: modifyFields(model, { notificationsClear: () => "Cleared" }) }
				: { model },
		// Best effort, like legacy: no toast, and the next shared change sends it again.
		FailedClearNotifications: ({ channelId }) =>
			channelId === model.channelId
				? { model: modifyFields(model, { notificationsClear: () => "NotSent" }) }
				: { model },
		GotFilesMessage: ({ message: filesMessage }) =>
			model.tab._tag === "Files"
				? liftFiles(model, FilesPage.update(model.tab.files, filesMessage))
				: { model },
	})

/** Message facts the overlays read when a menu opens. */
export const factsOf = (model: Model): Overlays.MessageFacts => {
	const find = (messageId: MessageId) => model.messages.find((message) => message.id === messageId)
	return {
		isOwnMessage: (messageId) => find(messageId)?.authorId === model.currentUserId,
		isPinned: (messageId) => find(messageId)?.isPinned ?? false,
		isThreadChannel: model.channel?.type === "thread",
	}
}

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
