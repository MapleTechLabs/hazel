import type { ChannelId, ChannelMemberId, MessageId, UserId } from "@hazel/schema"
import { Record, Struct } from "effect"
import { Command } from "foldkit"
import * as Live from "../../../chat/live-state"
import * as Unfurl from "../../../chat/unfurl"
import { modifyFields } from "foldkit/struct"
import * as Composer from "../../../composer/composer"
import * as Draft from "../../../composer/draft"
import * as MessageList from "../../../mount/message-list"
import { AppRoute, hrefOf } from "../../../route"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { replyIdsOf, threadIdsOf, toDeriveContext, toDisplayRows, unfurlRequestsOf } from "../derive"
import { emptyLookups, type Lookups } from "../lookups"
import * as FilesPage from "../files/page"
import * as Overlays from "../overlays"
import { PAGE_SIZE } from "../queries"
import { applyMessageChanges, shareIds, shareKeys, shareMessages, shareStickyKeys } from "../rows"
import { type ChatTab, Message, type Model, type PageReturn } from "./model"
import * as Write from "./write"

/** Channel page (`routes/_app/$orgSlug/chat/$id.tsx` + `$id/index.tsx`), read path. */

export { ChatTab, Message, Model, type PageReturn } from "./model"

// INIT

export const listId = (channelId: string) => `message-list-${channelId}`

export interface InitOptions {
	readonly tab?: ChatTab
	readonly orgSlug?: string
	/** What the previous channel's page hands on (`switchChannel`). */
	readonly carry?: {
		readonly viewportHeight: number
		readonly heightsByChannel: Model["heightsByChannel"]
	}
}

export const init = (
	channelId: ChannelId,
	currentUserId: UserId | null,
	options: InitOptions = {},
): Model => ({
	channelId,
	tab: options.tab ?? "messages",
	orgSlug: options.orgSlug ?? null,
	currentUserId,
	channel: null,
	parentChannel: null,
	hasLoadedMessages: false,
	messages: [],
	reactions: [],
	lookups: emptyLookups,
	members: null,
	pinned: [],
	threadMessages: [],
	typing: [],
	typingNowMs: 0,
	replyIds: [],
	threadIds: [],
	unfurls: {},
	liveStates: {},
	liveIds: [],
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
	files: filesFor(channelId, options.orgSlug ?? null, options.tab ?? "messages", null),
	draft: Draft.init(channelId, composerEditorId(channelId)),
	threadDraft: null,
	threadMemberId: null,
	pendingThreadChannelId: null,
	isGeneratingThreadName: false,
	hasClearedNotifications: false,
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
	return init(channelId, model.currentUserId, {
		...options,
		carry: {
			viewportHeight: model.list.viewportHeight,
			heightsByChannel: Object.fromEntries(remembered),
		},
	})
}

export const composerEditorId = (channelId: string) => `composer-${channelId}`

/** The Files Submodel for a tab: kept across `files` and `files/media`, dropped on Messages.
 * It waits for the org slug, which its links need. */
const filesFor = (
	channelId: ChannelId,
	orgSlug: string | null,
	tab: ChatTab,
	previous: FilesPage.Model | null,
): FilesPage.Model | null =>
	tab === "messages" || orgSlug === null
		? null
		: previous === null
			? FilesPage.init(channelId, orgSlug, tab)
			: FilesPage.setView(previous, tab)

/** The route moved between this channel's tabs. */
export const setTab = (model: Model, tab: ChatTab): Model =>
	model.tab === tab
		? model
		: modifyFields(model, {
				tab: () => tab,
				files: (files) => filesFor(model.channelId, model.orgSlug, tab, files),
			})

// ROUTES

const tabRoutes = {
	messages: AppRoute.ChatChannel,
	files: AppRoute.ChatFiles,
	media: AppRoute.ChatFilesMedia,
} as const

export const tabPath = (orgSlug: string, channelId: ChannelId, tab: ChatTab) =>
	hrefOf(tabRoutes[tab]({ orgSlug, channelId }))

// UPDATE

const liftList = (model: Model, result: MessageList.ListReturn): PageReturn => ({
	// An unchanged list keeps the page reference, so ignored events cost no render.
	model: result.model === model.list ? model : modifyFields(model, { list: () => result.model }),
	commands: Command.mapMessages(result.commands, (message) => Message.GotListMessage({ message })),
})

/** The derive context with the page's unfurls and live states. */
export const deriveContextOf = (model: Model) =>
	toDeriveContext(model.lookups, model.currentUserId ?? undefined, {
		unfurls: model.unfurls,
		liveStates: model.liveStates,
	})

/**
 * Starts the unfurl fetches the loaded messages need and marks them loading (legacy runs one atom
 * query per URL or tweet id, shared by every message that shows it).
 */
const requestUnfurls = (model: Model, messages: ReadonlyArray<Model["messages"][number]>) => {
	const pending: Record<string, Unfurl.Unfurl> = {}
	const commands: Array<Command.Command<Message>> = []
	for (const message of messages)
		for (const request of unfurlRequestsOf(message)) {
			if (request.key in model.unfurls || request.key in pending) continue
			pending[request.key] = Unfurl.Unfurl.Loading()
			const command: Command.Command<Unfurl.Message> =
				request.kind === "tweet"
					? Unfurl.FetchTweet({ tweetId: request.value })
					: Unfurl.FetchLinkPreview({ url: request.value })
			commands.push(...Command.mapMessages([command], (message) => Message.GotUnfurlMessage({ message })))
		}
	return commands.length === 0
		? { model, commands }
		: { model: modifyFields(model, { unfurls: Struct.assign(pending) }), commands }
}

/** Re-derives the rows, then tells the list about the new keys so it can keep its anchor. */
const deriveRows = (current: Model): PageReturn => {
	const requested = requestUnfurls(current, [...current.messages, ...current.threadMessages])
	const model = requested.model
	const rows = toDisplayRows(model.messages, model.reactions, deriveContextOf(model), model.rows)
	const isShown = (messageId: MessageId) => rows.some((row) => row.key === messageId)
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
	return { ...listed, commands: [...requested.commands, ...(listed.commands ?? [])] }
}

/** The live reply ids, re-read only when the window's or the thread panel's messages change. */
const withLiveIds = (model: Model): Model => {
	const liveIds = shareIds(model.liveIds, Live.connectedMessageIds([...model.messages, ...model.threadMessages]))
	return liveIds === model.liveIds ? model : modifyFields(model, { liveIds: () => liveIds })
}

const withLookup = <K extends keyof Lookups>(model: Model, key: K, value: Lookups[K]): PageReturn =>
	deriveRows(modifyFields(model, { lookups: (lookups) => ({ ...lookups, [key]: value }) }))

/** The most messages the window holds (S2 condition 1); past it, older pages slide the window. */
export const MAX_WINDOW = 10 * PAGE_SIZE

/** Grows the window by a page near the oldest message, then slides it; near the end it slides back. */
const loadWhenNearEdge = (result: PageReturn): PageReturn => {
	const { model } = result
	const isPageFull = model.messages.length >= model.limit
	if (isPageFull && MessageList.isNearStart(model.list)) {
		const next =
			model.limit < MAX_WINDOW
				? modifyFields(model, { limit: (limit) => limit + PAGE_SIZE })
				: modifyFields(model, { offset: (offset) => offset + PAGE_SIZE })
		return { ...result, model: withWindowFollow(next) }
	}
	if (model.offset > 0 && MessageList.isNearEnd(model.list))
		return {
			...result,
			model: withWindowFollow(modifyFields(model, { offset: (offset) => Math.max(0, offset - PAGE_SIZE) })),
		}
	return result
}

/** Only a window that reaches the newest message follows the end. */
const withWindowFollow = (model: Model): Model => {
	const list = MessageList.setCanFollowEnd(model.list, model.offset === 0)
	return list === model.list ? model : modifyFields(model, { list: () => list })
}

/** Back to the newest page (after sending from a scrolled-back window). */
export const resetWindow = (model: Model): Model =>
	model.offset === 0 ? model : withWindowFollow(modifyFields(model, { offset: () => 0, limit: () => PAGE_SIZE }))

const liftOverlays = (model: Model, result: Overlays.OverlaysReturn): PageReturn => {
	const synced =
		result.model === model.overlays
			? { model }
			: Write.syncThreadDraft(modifyFields(model, { overlays: () => result.model }))
	const next = synced.model
	const commands = [
		...Command.mapMessages(result.commands ?? [], (message) => Message.GotOverlaysMessage({ message })),
		...(synced.commands ?? []),
	]
	if (result.outMessage === undefined) return { model: next, commands }
	const handled = Write.handleOverlaysOut(next, result.outMessage)
	return { ...handled, commands: [...commands, ...(handled.commands ?? [])] }
}

/** Runs a second step on the first's Model, keeping both steps' commands. */
const combine = (first: PageReturn, second: (model: Model) => PageReturn): PageReturn => {
	const next = second(first.model)
	return {
		...next,
		commands: [...(first.commands ?? []), ...(next.commands ?? [])],
		...(first.outMessage === undefined || next.outMessage !== undefined ? {} : { outMessage: first.outMessage }),
	}
}

export const update = (model: Model, message: Message, shared: Shared | null = null): PageReturn =>
	Message.match<PageReturn>(message, {
		UpdatedChannel: ({ channel }) => ({ model: modifyFields(model, { channel: () => channel }) }),
		UpdatedOrgSlug: ({ orgSlug }) =>
			orgSlug === null || model.orgSlug !== null
				? { model }
				: {
						model: modifyFields(model, {
							orgSlug: () => orgSlug,
							files: (files) => filesFor(model.channelId, orgSlug, model.tab, files),
						}),
					},
		// Navigation is an OutMessage, raised by the page definition (`index.ts`).
		ClickedTab: () => ({ model }),
		UpdatedParentChannel: ({ channel }) => ({
			model: modifyFields(model, { parentChannel: () => channel }),
		}),
		UpdatedMessages: ({ messages }) =>
			deriveRows(
				withLiveIds(
					modifyFields(model, {
						hasLoadedMessages: () => true,
						messages: (previous) => shareMessages(previous, messages),
					}),
				),
			),
		ChangedMessages: ({ order, upserts }) =>
			deriveRows(
				withLiveIds(
					modifyFields(model, {
						hasLoadedMessages: () => true,
						messages: (previous) => applyMessageChanges(previous, order, upserts),
					}),
				),
			),
		UpdatedReactions: ({ reactions }) => deriveRows(modifyFields(model, { reactions: () => reactions })),
		UpdatedUsers: ({ users }) => withLookup(model, "users", users),
		UpdatedPresence: ({ presence }) =>
			combine(
				withLookup(model, "presence", presence),
				(next) => Write.forwardComposerData(next, Composer.Message.UpdatedPresence({ presence: Write.toComposerPresence(presence) })),
			),
		UpdatedBots: ({ bots }) => withLookup(model, "bots", bots),
		UpdatedCustomEmojis: ({ customEmojis }) =>
			combine(
				withLookup(model, "customEmojis", customEmojis),
				(next) => Write.forwardComposerData(next, Composer.Message.UpdatedCustomEmojis({ emojis: customEmojis })),
			),
		UpdatedAttachments: ({ attachments }) => withLookup(model, "attachments", attachments),
		UpdatedDiscordSynced: ({ messageIds }) => withLookup(model, "discordSyncedIds", messageIds),
		UpdatedThreadChannels: ({ channels }) => withLookup(model, "threadChannels", channels),
		UpdatedThreadMessages: ({ messages }) => withLookup(model, "threadMessages", messages),
		UpdatedReplyTargets: ({ targets }) => withLookup(model, "replyTargets", targets),
		UpdatedMembers: ({ members }) => ({ model: modifyFields(model, { members: () => members }) }),
		UpdatedPinned: ({ pins }) => ({ model: modifyFields(model, { pinned: () => pins }) }),
		UpdatedThreadPanelMessages: ({ messages }) =>
			requestUnfurls(
				withLiveIds(modifyFields(model, { threadMessages: (previous) => shareMessages(previous, messages) })),
				messages,
			),
		UpdatedTyping: ({ typing }) => ({ model: modifyFields(model, { typing: () => typing }) }),
		TickedTypingClock: ({ nowMs }) => ({ model: modifyFields(model, { typingNowMs: () => nowMs }) }),
		GotUnfurlMessage: ({ message: unfurlMessage }) =>
			deriveRows(modifyFields(model, { unfurls: (unfurls) => Unfurl.applyMessage(unfurls, unfurlMessage) })),
		GotLiveMessage: ({ message: liveMessage }) =>
			deriveRows(modifyFields(model, { liveStates: (states) => Live.applyMessage(states, liveMessage) })),
		GotListMessage: ({ message: listMessage }) =>
			loadWhenNearEdge(liftList(model, MessageList.update(model.list, listMessage))),
		GotOverlaysMessage: ({ message: overlaysMessage }) =>
			liftOverlays(model, Overlays.update(model.overlays, overlaysMessage, factsOf(model))),
		// Reported to the root as `RequestedMobileSidebar` by `index.ts`.
		ClickedMobileMenu: () => ({ model }),
		GotDraftMessage: ({ message: draftMessage }) => Write.updateDraft(model, "channel", draftMessage, shared),
		GotThreadDraftMessage: ({ message: draftMessage }) => Write.updateDraft(model, "thread", draftMessage, shared),
		GotActionMessage: ({ message: actionMessage }) => Write.handleActionMessage(model, actionMessage),
		UpdatedThreadMember: ({ memberId }) => ({ model: modifyFields(model, { threadMemberId: () => memberId }) }),
		ClickedGenerateThreadName: () => Write.generateThreadName(model),
		ClickedRenameThread: () =>
			model.overlays.thread === null
				? { model }
				: {
						model,
						outMessage: PageOutMessage.RequestedModal({
							modal: { _tag: "RenameThread", threadId: model.overlays.thread.threadChannelId },
						}),
					},
		PressedGlobalKey: ({ key }) => Write.insertGlobalKey(model, key),
		LeftWindow: () => {
			const channel = Write.updateDraft(model, "channel", Draft.Message.LeftWindow(), shared)
			if (channel.model.threadDraft === null) return channel
			const thread = Write.updateDraft(channel.model, "thread", Draft.Message.LeftWindow(), shared)
			return { ...thread, commands: [...(channel.commands ?? []), ...(thread.commands ?? [])] }
		},
		SucceededClearNotifications: () => ({ model }),
		FailedClearNotifications: () => ({ model }),
		GotFilesMessage: ({ message: filesMessage }) => {
			if (model.files === null) return { model }
			const result = FilesPage.update(model.files, filesMessage)
			return {
				model: modifyFields(model, { files: () => result.model }),
				commands: Command.mapMessages(result.commands ?? [], (message) =>
					Message.GotFilesMessage({ message }),
				),
			}
		},
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

/** `useIsChannelMember`: unknown until the members query has answered. */
export const isMemberOf = (model: Model): boolean | null =>
	model.members === null || model.currentUserId === null
		? null
		: model.members.some((member) => member.userId === model.currentUserId)
