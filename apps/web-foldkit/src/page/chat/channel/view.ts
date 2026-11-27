import type { MessageId } from "@hazel/schema"
import { hole } from "../../../app/holes"
import { createLazy, type Html, type HtmlBuilder } from "foldkit/html"
import { cn } from "~/lib/utils"
import { button } from "../../../ui/button"
import { splitContentClassName, splitRootClassName } from "../../../ui/split-panel"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { htmlRenderFullscreenView } from "../../../chat/embeds/html-render"
import type * as HtmlRender from "../../../chat/html-render"
import { imageViewerView } from "../../../chat/image-viewer"
import type { RowContext } from "../../../chat/message/row"
import type * as Draft from "../../../composer/draft"
import { draftView } from "../../../composer/draft-view"
import { mobileBackLink } from "../../../shell/mobile"
import { joinBannerView, typingIndicatorView } from "../banners"
import { attachmentInfoFrom, composerAreaView, replyPreviewOf } from "../composer-view"
import { authorIdentity, toDeriveContext } from "../derive"
import * as FilesPage from "../files/page"
import * as FilesView from "../files/view"
import { chatHeaderView } from "../header"
import {
	type ChannelLinks,
	type ChannelLinksMap,
	linksFor,
	NO_CHANNEL_LINKS,
	NO_CHANNEL_LINKS_MAP,
} from "../../../ui/channel-icon"
import { messageToolbarOverlay, reactionModalView, trackHoverAttribute } from "../overlay-views"
import * as Overlays from "../overlays"
import { pinnedPopoverView } from "../pinned"
import { threadRowContextFor } from "../row-context"
import type { MessageRow } from "../rows"
import * as CustomerCard from "../customer-card"
import { chatTabBarView } from "../tab-bar"
import { threadPanelView } from "../thread-panel"
import * as IssueControl from "../issue-control"
import * as NotificationControl from "../notification-control"
import { AppRoute, customerRoute, hrefOf } from "../../../route"
import { isMemberOf, Message, type Model, routeTabOf, type ThreadPanel } from "./page"
import { threadPanelWidthOf } from "./thread-width"
import { isParityOff } from "../../../root/native-pages"
import { openViewerOf } from "./viewer-images"

/** The channel route's content: header, tab bar, message list and composer (desktop). */

type H = HtmlBuilder<Message>

// The page's mappers, built once, so the lazy views that take them keep their memo.

const toSelf = (message: Message) => message
const toDraftMessage = (message: Draft.Message) => Message.GotDraftMessage({ message })
const toThreadDraftMessage = (message: Draft.Message) => Message.GotThreadDraftMessage({ message })
const toFilesMessage = (message: FilesPage.Message) => Message.GotFilesMessage({ message })
const toOverlay = (message: Overlays.Message) => Message.GotOverlaysMessage({ message })
const toHtmlRenderMessage = (message: HtmlRender.Message) => Message.GotHtmlRenderMessage({ message })
const toPressEdge = (clientX: number, startWidth: number, maxWidth: number) =>
	Message.PressedThreadPanelEdge({ clientX, startWidth, maxWidth })
const toNudgeEdge = (delta: number) => Message.PressedThreadPanelEdgeKey({ delta })
const toIssueControlMessage = (message: IssueControl.Message) => Message.GotIssueControlMessage({ message })
const toCustomerCard = (message: CustomerCard.Message) => Message.GotCustomerCardMessage({ message })
const toNotificationControl = (message: NotificationControl.Message) =>
	Message.GotNotificationControlMessage({ message })
const toPinnedMessage = (message: Parameters<typeof Overlays.Message.GotPinnedMessage>[0]["message"]) =>
	toOverlay(Overlays.Message.GotPinnedMessage({ message }))
const pinnedActions = {
	toJump: (messageId: MessageId) => toOverlay(Overlays.Message.ClickedPinnedMessage({ messageId })),
	toUnpin: (messageId: MessageId) => toOverlay(Overlays.Message.ClickedUnpin({ messageId })),
}

/** `ImageViewerModal` for the message whose attachment was clicked. */
const imageViewerOverlay = (h: H, model: Model): Html => {
	const open = openViewerOf(model)
	if (open === null) return h.empty
	const { row, images, index } = open
	return imageViewerView(h, {
		images,
		index,
		author: !row.hasAuthor
			? null
			: {
					name: row.author.displayName,
					avatarUrl: row.author.avatarUrl,
					seed: row.author.displayName,
				},
		createdAtMs: row.message.createdAtMs,
		toClose: () => toOverlay(Overlays.Message.ClosedImageViewer()),
		toSelect: (index) => toOverlay(Overlays.Message.SelectedViewerImage({ index })),
		toAction: (action, image) =>
			toOverlay(
				Overlays.Message.ClickedViewerAction({ action, url: image.url, fileName: image.fileName }),
			),
		menu: {
			model: model.overlays.viewerMenu,
			toMessage: (message) => toOverlay(Overlays.Message.GotViewerMenuMessage({ message })),
		},
	})
}

/** The Files or All media page's place (`src/root/app.ts`), keyed by tab and channel. */
const filesHole = (h: H, model: Model, view: "files" | "media"): Html =>
	hole(h, "channel-files", `${view === "media" ? "ChatFilesMedia" : "ChatFiles"}:${model.channelId}`, [
		h.Class(MESSAGE_LIST_HOLE),
	])

/** The shared message list's place (`src/root/portal.ts`): keyed by channel, so a switch starts fresh. */
const messageListHole = (h: H, model: Model): Html | undefined =>
	model.currentUserId === null
		? undefined
		: hole(h, "message-list", model.channelId, [h.Class(MESSAGE_LIST_HOLE)])

/** The screen's root fills the hole, so its list scrolls inside it. */
const MESSAGE_LIST_HOLE = "flex min-h-0 flex-1 flex-col"

/** `$id/index.tsx`: the join banner for non-members, else the list and the composer. */
const messagesOutlet = (h: H, model: Model, nowMs: number, channelLinks: ChannelLinksMap) => {
	if (isMemberOf(model) === false)
		return [
			joinBannerView(h, model.channel, {
				isJoining: model.isJoining,
				onJoin: Message.ClickedJoinChannel(),
				links: headerLinks(
					linksFor(channelLinks, model.channelId),
					model.customer,
					model.lookups.syncProvider,
				),
			}),
		]
	// Passed to the lazy composer as strings, so an unchanged reply keeps its memo.
	const reply = replyPreviewOf(model, model.draft)
	const list = messageListHole(h, model)
	return [
		h.div(
			[h.Class("relative flex min-h-0 flex-1 flex-col overflow-hidden")],
			list === undefined ? [] : [list],
		),
		lazyComposer(composerView, [
			model.typingNames,
			model.draft,
			reply?.authorName ?? null,
			reply?.firstLine ?? null,
			model.lookups.attachments,
			h,
		]) ?? h.empty,
		imageViewerOverlay(h, model),
		lazyToolbar(messageToolbarOverlay, [h, toolbarInputOf(model)]) ?? h.empty,
		reactionModalView(h, model),
	]
}

const composerView = (
	typingNames: ReadonlyArray<string>,
	draft: Draft.Model,
	replyAuthorName: string | null,
	replyFirstLine: string | null,
	attachments: Model["lookups"]["attachments"],
	h: H,
) =>
	composerAreaView(h, typingIndicatorView(h, typingNames), draft, {
		toMessage: toDraftMessage,
		replyPreview:
			replyAuthorName === null || replyFirstLine === null
				? null
				: { authorName: replyAuthorName, firstLine: replyFirstLine },
		attachmentInfo: attachmentInfoFrom(attachments),
	})

/**
 * The page's own customer and sync rows know about this channel before the org-wide lists do (and
 * for a channel the sidebar does not list), so they win; Connect partners come from the org's.
 */
const headerLinks = (
	shared: ChannelLinks,
	customer: Model["customer"],
	syncProvider: Model["lookups"]["syncProvider"],
): ChannelLinks => ({
	customer:
		customer === null
			? shared.customer
			: { name: customer.accountName, logoUrl: customer.accountLogoUrl ?? null },
	partners: shared.partners,
	syncProvider: syncProvider ?? shared.syncProvider,
})

/**
 * The header's clock: to the minute, so the 30 s ticks keep its memo, or the bell's mute end once it
 * has passed within the minute, so the bell unmutes when the sidebar row does.
 */
const headerClockOf = (model: Model, nowMs: number): number => {
	const minuteMs = Math.floor(nowMs / 60_000) * 60_000
	const mutedUntilMs =
		(model.members ?? []).find((member) => member.userId === model.currentUserId)?.mutedUntilMs ?? null
	return mutedUntilMs !== null && mutedUntilMs > minuteMs && mutedUntilMs <= nowMs ? mutedUntilMs : minuteMs
}

const headerView = (
	channel: Model["channel"],
	parentChannel: Model["parentChannel"],
	orgSlug: Model["orgSlug"],
	members: Model["members"],
	lookups: Model["lookups"],
	currentUserId: Model["currentUserId"],
	pinnedPopover: Model["overlays"]["pinned"],
	pins: Model["pinned"],
	customer: Model["customer"],
	isCustomerCardOpen: boolean,
	isMobile: boolean,
	channelLinks: ChannelLinksMap,
	notificationControl: Model["notificationControl"],
	/** The clock to the minute, or the bell's mute end (`headerClockOf`). */
	minuteMs: number,
	h: H,
): Html => {
	const users = new Map(lookups.users.map((user) => [user.id, user]))
	const botNames = new Map(lookups.bots.map((bot) => [bot.userId, bot.name]))
	const others = (members ?? []).filter((member) => member.userId !== currentUserId)
	const currentMember = (members ?? []).find((member) => member.userId === currentUserId)
	const partner = channel?.type === "single" && others.length === 1 ? others[0] : undefined
	const dmPresence =
		partner === undefined || botNames.has(partner.userId)
			? null
			: getEffectivePresenceStatus(
					lookups.presence.find((presence) => presence.userId === partner.userId),
				)
	return chatHeaderView(h, {
		channel,
		links: headerLinks(linksFor(channelLinks, channel?.id ?? ""), customer, lookups.syncProvider),
		parentLinks: parentChannel === null ? NO_CHANNEL_LINKS : linksFor(channelLinks, parentChannel.id),
		parentChannel,
		orgSlug,
		isMember: currentMember !== undefined,
		otherMembers: [...others].reverse().flatMap((member) => {
			const user = users.get(member.userId)
			return user ? [authorIdentity(user, botNames.get(member.userId))] : []
		}),
		isHiddenDm: currentMember?.isHidden ?? false,
		onUnhide: Message.ClickedUnhideConversation(),
		dmPresence,
		// A phone opens a conversation from the chat list, a DM from the DMs tab; a thread from its channel.
		mobileBack:
			isMobile && orgSlug !== null
				? channel?.type === "thread" && channel.parentChannelId
					? mobileBackLink(
							h,
							hrefOf(AppRoute.ChatChannel({ orgSlug, channelId: channel.parentChannelId })),
							parentChannel?.name ?? "channel",
							"-ml-3 -mr-1",
						)
					: channel?.type === "direct" || channel?.type === "single"
						? // A DM leads back to the DMs tab's list.
							mobileBackLink(h, hrefOf(AppRoute.ChatDms({ orgSlug })), "DMs", "-ml-3 -mr-1")
						: mobileBackLink(h, hrefOf(AppRoute.ChatIndex({ orgSlug })), "Chats", "-ml-3 -mr-1")
				: h.empty,
		pinnedTrigger: pinnedPopoverView(h, pinnedPopover, pins, toPinnedMessage, pinnedActions),
		notificationsTrigger:
			channel === null
				? h.empty
				: currentMember === undefined
					? // A thread you do not follow (its access is its parent's): follow it here.
						channel.type === "thread"
						? button(
								h,
								{ intent: "outline", size: "sm", onPress: Message.ClickedFollowThread() },
								["Follow thread"],
							)
						: h.empty
					: NotificationControl.view(
							h,
							notificationControl,
							currentMember,
							channel.type,
							minuteMs,
							toNotificationControl,
						),
		customerChip:
			customer === null
				? null
				: CustomerCard.chip(h, {
						customer,
						isOpen: isCustomerCardOpen,
						isMobile,
						toMessage: toCustomerCard,
					}),
	})
}

/**
 * A view memo, not state: hands back the last page given while `isEqual` holds, so a lazy view
 * keyed on it keeps its memo when the page changed only in fields that view never reads.
 */
const stableInput = (isEqual: (a: Model, b: Model) => boolean) => {
	const last: { model: Model | null } = { model: null }
	return (model: Model): Model => {
		if (last.model !== null && isEqual(last.model, model)) return last.model
		last.model = model
		return model
	}
}

/** Everything `messageToolbarOverlay` reads from the page. */
const isToolbarInputEqual = (a: Model, b: Model) =>
	a.overlays === b.overlays &&
	a.rows === b.rows &&
	a.messages === b.messages &&
	a.threadPanel?.rows === b.threadPanel?.rows &&
	a.threadPanel?.messages === b.threadPanel?.messages &&
	a.currentUserId === b.currentUserId &&
	a.channel === b.channel &&
	a.lookups.customEmojis === b.lookups.customEmojis
const toolbarInputOf = stableInput(isToolbarInputEqual)
const lazyToolbar = createLazy()

// The chrome around the list only changes with the channel, not on every scroll frame.
const lazyHeader = createLazy()
const lazyTabBar = createLazy()
const lazyComposer = createLazy()
const lazyThreadPanel = createLazy()

export interface ViewOptions {
	readonly isMobile?: boolean
	/** `Shared.nowMs`, the presence clock the profile popover and the Files dates read. */
	readonly nowMs?: number
	/** `Shared.channelLinks`: what the header's channel icon marks. */
	readonly channelLinks?: ChannelLinksMap
}

/** `SplitPanelRoot` > `SplitPanelContent` with the channel's current tab inside. */
export const view = (h: H, model: Model, options: ViewOptions = {}): Html => {
	const nowMs = options.nowMs ?? 0
	// Keyed by channel like React's `key={id}`: Mounts start on insert only, so a patched-in-place
	// page would keep the previous channel's list observer and never measure the new viewport.
	return h.keyed("div")(
		model.channelId,
		[
			h.Class(
				splitRootClassName(
					cn(
						// A phone's shell sizes the page; the desktop's is the window.
						"relative h-full md:h-dvh",
						// While the thread panel's edge is dragged: no text selection, and frames never take the pointer.
						model.threadPanelDrag !== null &&
							"cursor-col-resize select-none [&_iframe]:pointer-events-none",
					),
				),
			),
		],
		[
			h.div(
				[h.Class(splitContentClassName())],
				[
					lazyHeader(headerView, [
						model.channel,
						model.parentChannel,
						model.orgSlug,
						model.members,
						model.lookups,
						model.currentUserId,
						model.overlays.pinned,
						model.pinned,
						model.customer,
						CustomerCard.isOpenOf(model.customerCard, options.isMobile ?? false),
						options.isMobile ?? false,
						options.channelLinks ?? NO_CHANNEL_LINKS_MAP,
						model.notificationControl,
						headerClockOf(model, nowMs),
						h,
					]) ?? h.empty,
					customerCardView(h, model, options.isMobile ?? false, nowMs),
					lazyTabBar(chatTabBarView, [routeTabOf(model.tab), toSelf, h]) ?? h.empty,
					...(model.tab._tag === "Files"
						? isParityOff(model.tab.files.view === "media" ? "ChatFilesMedia" : "ChatFiles")
							? [
									FilesView.view(h, model.tab.files, toFilesMessage, nowMs),
									FilesView.imageViewerOverlay(h, model.tab.files, toFilesMessage),
								]
							: [filesHole(h, model, model.tab.files.view)]
						: messagesOutlet(h, model, nowMs, options.channelLinks ?? NO_CHANNEL_LINKS_MAP)),
				],
			),
			model.threadPanel === null
				? h.empty
				: (lazyThreadPanel(threadPanelOverlay, [
						model.threadPanel,
						model.lookups,
						model.messages,
						// Only the starter's row: the panel keeps its memo while other channel rows change.
						starterRowOf(model, model.threadPanel.messageId),
						model.currentUserId,
						model.orgSlug,
						model.customer !== null,
						threadPanelWidthOf(model),
						model.threadPanelDrag !== null,
						// Only what the panel's frames read: not the fullscreen dialog or the theme's variables.
						model.htmlRender.urls,
						model.htmlRender.frames,
						model.htmlRender.theme?.appearance ?? "dark",
						threadRowContextFor(h, model, model.threadPanel.rows, nowMs),
						// The SLA chip's clock: only an issue with one re-renders the panel every tick.
						model.threadPanel.issue.sla === null ? 0 : nowMs,
						h,
					]) ?? h.empty),
			// Outside the tabs: the list's frames and the thread panel's both open it.
			htmlRenderFullscreenView(h, model.htmlRender, toHtmlRenderMessage),
		],
	)
}

/** The customer chip's card (desktop) or sheet (phone); nothing while the channel has no customer. */
const customerCardView = (h: H, model: Model, isMobile: boolean, nowMs: number): Html => {
	const customer = model.customer
	if (customer === null) return h.empty
	const owner =
		customer.ownerUserId === null
			? undefined
			: model.lookups.users.find((user) => user.id === customer.ownerUserId)
	const context: CustomerCard.CardContext = {
		customer,
		ownerName: owner === undefined ? null : `${owner.firstName} ${owner.lastName}`.trim() || owner.email,
		customerHref: hrefOf(customerRoute(model.orgSlug, customer.accountId)),
		queueHref: hrefOf(AppRoute.CustomersAttention({ orgSlug: model.orgSlug })),
		nowMs,
	}
	const inputs = { context, model: model.customerCard, toMessage: toCustomerCard }
	return isMobile ? CustomerCard.sheet(h, inputs) : CustomerCard.card(h, inputs)
}

/** The thread's starter message as the channel list shows it; null outside the loaded window. */
const starterRowOf = (model: Model, messageId: string): MessageRow | null => {
	const row = model.rows.find((candidate) => candidate.key === messageId)
	return row?._tag === "MessageRow" ? row : null
}

/** The `SplitPanel` beside the channel while a thread is open. */
const threadPanelOverlay = (
	panel: ThreadPanel,
	lookups: Model["lookups"],
	messages: Model["messages"],
	originalRow: MessageRow | null,
	currentUserId: Model["currentUserId"],
	orgSlug: Model["orgSlug"],
	isLinked: boolean,
	width: number,
	isResizing: boolean,
	urls: HtmlRender.Model["urls"],
	frames: HtmlRender.Model["frames"],
	appearance: "light" | "dark",
	rowContext: RowContext<Message>,
	slaNowMs: number,
	h: H,
): Html => {
	// The original message's HTML renders show here too, so the panel re-renders with their state.
	const context = toDeriveContext(lookups, currentUserId ?? undefined, {
		unfurls: {},
		liveStates: {},
		htmlRenders: { urls, frames },
		appearance,
	})
	const name = lookups.threadChannels.find((channel) => channel.id === panel.threadChannelId)?.name
	return threadPanelView(h, {
		threadName: name || "Thread",
		original: messages.find((message) => message.id === panel.messageId) ?? null,
		originalRow,
		rows: panel.rows,
		context,
		rowContext,
		toHtmlRenderMessage,
		width,
		isResizing,
		toPressEdge,
		toNudgeEdge,
		fullViewHref:
			panel.creation === "Created"
				? hrefOf(AppRoute.ChatChannel({ orgSlug, channelId: panel.threadChannelId }))
				: null,
		onClose: Message.ClickedCloseThread(),
		onGenerateName: Message.ClickedGenerateThreadName(),
		onRename: Message.ClickedRenameThread(),
		isFollowing: panel.creation === "Created" ? panel.memberId !== null : null,
		onToggleFollow: Message.ClickedToggleFollowThread(),
		isGeneratingName: panel.isNaming,
		isCreating: panel.creation === "Creating",
		trackHover: trackHoverAttribute(h),
		issueControl: isLinked
			? IssueControl.view(h, {
					model: panel.issue,
					inboxHref: hrefOf(AppRoute.CustomersInbox({ orgSlug })),
					currentUserId,
					nowMs: slaNowMs,
					toMessage: toIssueControlMessage,
				})
			: h.empty,
		composer: draftView(h, panel.draft, {
			toMessage: toThreadDraftMessage,
			replyPreview: replyPreviewOf(
				{ lookups, currentUserId, messages, threadPanel: panel },
				panel.draft,
			),
			attachmentInfo: attachmentInfoFrom(lookups.attachments),
		}),
	})
}
