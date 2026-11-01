import { createLazy, type Html, type HtmlBuilder } from "foldkit/html"
import { contentStyles, rootStyles } from "~/components/ui/split-panel/split-panel.styles"
import { cn } from "~/lib/utils"
import { isImageAttachment } from "../../../chat/attachments"
import { htmlRenderFullscreenView } from "../../../chat/embeds/html-render"
import type * as HtmlRender from "../../../chat/html-render"
import { imageViewerView } from "../../../chat/image-viewer"
import { dateDividerView, messageRowView, type RowContext } from "../../../chat/message/row"
import type * as Draft from "../../../composer/draft"
import { draftView } from "../../../composer/draft-view"
import * as MessageList from "../../../mount/message-list"
import { mobileMenuButton } from "../../../shell/mobile"
import { joinBannerView, typingIndicatorView } from "../banners"
import { attachmentInfoFrom, composerAreaView, replyPreviewOf } from "../composer-view"
import { authorIdentity, toDeriveContext } from "../derive"
import * as FilesPage from "../files/page"
import * as FilesView from "../files/view"
import { chatHeaderView } from "../header"
import { messageToolbarOverlay, reactionModalView, trackHoverAttribute } from "../overlay-views"
import * as Overlays from "../overlays"
import { pinnedPopoverView } from "../pinned"
import { idleRowContext, rowContextFor } from "../row-context"
import type { DisplayRow, MessageRow } from "../rows"
import { chatTabBarView } from "../tab-bar"
import { threadPanelView } from "../thread-panel"
import { AppRoute, hrefOf } from "../../../route"
import { isMemberOf, Message, type Model, routeTabOf, type ThreadPanel } from "./page"
import { threadPanelWidthOf } from "./thread-width"

/** The channel route's content: header, tab bar, message list and composer (desktop). */

type H = HtmlBuilder<Message>

// The page's mappers, built once, so the lazy views that take them keep their memo.

const toSelf = (message: Message) => message
const toListMessage = (message: MessageList.Message) => Message.GotListMessage({ message })
const toDraftMessage = (message: Draft.Message) => Message.GotDraftMessage({ message })
const toThreadDraftMessage = (message: Draft.Message) => Message.GotThreadDraftMessage({ message })
const toFilesMessage = (message: FilesPage.Message) => Message.GotFilesMessage({ message })
const toOverlay = (message: Overlays.Message) => Message.GotOverlaysMessage({ message })
const toHtmlRenderMessage = (message: HtmlRender.Message) => Message.GotHtmlRenderMessage({ message })
const toPressEdge = (clientX: number, startWidth: number, maxWidth: number) =>
	Message.PressedThreadPanelEdge({ clientX, startWidth, maxWidth })
const toNudgeEdge = (delta: number) => Message.PressedThreadPanelEdgeKey({ delta })
const toPinnedMessage = (message: Parameters<typeof Overlays.Message.GotPinnedMessage>[0]["message"]) =>
	toOverlay(Overlays.Message.GotPinnedMessage({ message }))

const rowView = (
	row: DisplayRow,
	isStuck: boolean,
	isHovered: boolean,
	context: RowContext<Message>,
	h: H,
): Html =>
	row._tag === "DateHeader"
		? dateDividerView(h, row.label, isStuck)
		: messageRowView(h, row, context, isHovered)

// One memo slot per row object, a pure view memo: a row derived again gets a fresh slot and the old
// one goes with the old row (rows keep their identity while nothing they show changes).
const rowSlots = new WeakMap<DisplayRow, ReturnType<typeof createLazy>>()

const memoRow = (
	h: H,
	row: DisplayRow,
	isStuck: boolean,
	isHovered: boolean,
	context: RowContext<Message>,
): Html => {
	let slot = rowSlots.get(row)
	// createKeyedLazy never evicts and message rows are unbounded, so slots live with their row.
	// oxlint-disable-next-line foldkit/lazy-view-stable-references
	if (slot === undefined) rowSlots.set(row, (slot = createLazy()))
	return slot(rowView, [row, isStuck, isHovered, context, h]) ?? h.div([])
}

/** `MessageList`'s empty state. */
const emptyStateView = (h: H): Html =>
	h.div(
		[h.Class("flex size-full flex-col items-center justify-center p-4 sm:p-8")],
		[
			h.div(
				[h.Class("relative aspect-square w-full max-w-sm")],
				[
					h.img([
						h.Attribute("src", "/images/squirrle_ocean.webp"),
						h.Attribute("alt", "squirrel"),
						h.Class(
							"mask-size-[110%_90%] mask-linear-to-r mask-from-black mask-to-transparent mask-center mask-no-repeat mask-[url(/images/image-mask.webp)] h-full w-full rounded-md bg-center bg-cover bg-no-repeat object-cover opacity-50",
						),
					]),
				],
			),
			h.p([h.Class("font-bold font-mono text-fg text-xl")], ["Quiet as an ocean gazing squirrel..."]),
		],
	)

/** Everything `listView` reads from the page, so a page that differs elsewhere keeps the list memo. */
const isListInputEqual = (a: Model, b: Model) =>
	a.hasLoadedMessages === b.hasLoadedMessages &&
	a.messages === b.messages &&
	a.rows === b.rows &&
	a.overlays === b.overlays &&
	a.lookups === b.lookups &&
	a.currentUserId === b.currentUserId &&
	a.channel === b.channel &&
	MessageList.isViewEqual(a.list, b.list)

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

// Scroll events change only the list's offset, so they no longer rebuild the list.
const listInputOf = stableInput(isListInputEqual)
const lazyList = createLazy()

/** The presence clock only matters to an open profile popover; otherwise it is left out of the memo. */
const popoverClockOf = (model: Model, nowMs: number) => (model.overlays.open._tag === "Popover" ? nowMs : 0)

const messageListView = (h: H, model: Model, nowMs: number): Html =>
	lazyList(listView, [listInputOf(model), popoverClockOf(model, nowMs), h]) ?? h.empty

const listView = (model: Model, nowMs: number, h: H): Html => {
	if (!model.hasLoadedMessages) return h.div([])
	if (model.messages.length === 0) return emptyStateView(h)
	const idle = idleRowContext(h, model)
	const held = Overlays.heldMessageIdOf(model.overlays)
	const list = MessageList.view(h, model.list, {
		items: model.rows,
		itemToKey: (row) => row.key,
		itemToView: (row, { isStuck }) =>
			memoRow(
				h,
				row,
				isStuck,
				row.key === held,
				row._tag === "MessageRow" ? rowContextFor(h, model, row, idle, nowMs) : idle,
			),
		isStickyHeader: (row) => row._tag === "DateHeader",
		toParentMessage: toListMessage,
	})
	// Keyed: the not-yet-loaded placeholder is also a div, and a reused element never runs OnMount.
	return h.keyed("div")(
		"message-list-container",
		[
			h.Class(
				"isolate flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2 transition-opacity duration-200",
			),
			h.Attribute("style", "overflow-anchor: auto; scroll-behavior: auto; opacity: 1;"),
			trackHoverAttribute(h),
		],
		[
			// The legacy hover highlight (injected `#message-<id>` CSS) is a class on the hovered row:
			// rewriting a <style> invalidates every element's style, on each hover change while scrolling.
			list,
		],
	)
}

/** The row an image viewer opened from: a channel row, or a reply in the open thread. */
const viewerRowOf = (model: Model, messageId: string): MessageRow | undefined => {
	const row = model.rows.find((candidate) => candidate.key === messageId)
	if (row !== undefined) return row._tag === "MessageRow" ? row : undefined
	return model.threadPanel?.rows.find((candidate) => candidate.key === messageId)
}

/** `ImageViewerModal` for the message whose attachment was clicked. */
const imageViewerOverlay = (h: H, model: Model): Html => {
	const viewer = Overlays.imageViewerOf(model.overlays)
	if (viewer === null) return h.empty
	const row = viewerRowOf(model, viewer.messageId)
	if (row === undefined) return h.empty
	return imageViewerView(h, {
		images:
			viewer.urlImages === null
				? row.attachments.filter(isImageAttachment)
				: viewer.urlImages.map((image, index) => ({
						id: `${image.url}-${index}`,
						fileName: image.alt,
						fileSize: 0,
						url: image.url,
					})),
		index: viewer.index,
		author: row.message.author
			? {
					name: `${row.message.author.firstName} ${row.message.author.lastName}`,
					avatarUrl: row.message.author.avatarUrl,
					seed: `${row.message.author.firstName} ${row.message.author.lastName}`,
				}
			: null,
		createdAtMs: row.message.createdAtMs,
		toClose: () => toOverlay(Overlays.Message.ClosedImageViewer()),
		toSelect: (index) => toOverlay(Overlays.Message.SelectedViewerImage({ index })),
		toAction: (action, image) =>
			toOverlay(
				Overlays.Message.ClickedViewerAction({ action, url: image.url, fileName: image.fileName }),
			),
	})
}

/** `$id/index.tsx`: the join banner for non-members, else the list and the composer. */
const messagesOutlet = (h: H, model: Model, nowMs: number) => {
	if (isMemberOf(model) === false)
		return [
			joinBannerView(h, model.channel, {
				isJoining: model.isJoining,
				onJoin: Message.ClickedJoinChannel(),
			}),
		]
	// Passed to the lazy composer as strings, so an unchanged reply keeps its memo.
	const reply = replyPreviewOf(model, model.draft)
	return [
		h.div([h.Class("flex min-h-0 flex-1 flex-col overflow-hidden")], [messageListView(h, model, nowMs)]),
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

const headerView = (
	channel: Model["channel"],
	parentChannel: Model["parentChannel"],
	orgSlug: Model["orgSlug"],
	members: Model["members"],
	lookups: Model["lookups"],
	currentUserId: Model["currentUserId"],
	pinnedPopover: Model["overlays"]["pinned"],
	pins: Model["pinned"],
	isMobile: boolean,
	h: H,
): Html => {
	const users = new Map(lookups.users.map((user) => [user.id, user]))
	const botNames = new Map(lookups.bots.map((bot) => [bot.userId, bot.name]))
	const others = (members ?? []).filter((member) => member.userId !== currentUserId)
	const currentMember = (members ?? []).find((member) => member.userId === currentUserId)
	return chatHeaderView(h, {
		channel,
		parentChannel,
		orgSlug,
		isMember: currentMember !== undefined,
		otherMembers: [...others].reverse().flatMap((member) => {
			const user = users.get(member.userId)
			return user ? [authorIdentity(user, botNames.get(member.userId))] : []
		}),
		isHiddenDm: currentMember?.isHidden ?? false,
		// Legacy renders the menu button only on mobile (`isMobile` in `ChatHeader`).
		mobileMenu: (className) =>
			isMobile
				? mobileMenuButton(h, {
						onPress: h.OnClick(Message.ClickedMobileMenu()),
						...(className === undefined ? {} : { className }),
					})
				: h.empty,
		pinnedTrigger: pinnedPopoverView(h, pinnedPopover, pins, toPinnedMessage),
	})
}

/** Everything `messageToolbarOverlay` reads from the page. */
const isToolbarInputEqual = (a: Model, b: Model) =>
	a.overlays === b.overlays &&
	a.rows === b.rows &&
	a.messages === b.messages &&
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
				rootStyles({
					className: cn(
						"relative h-[calc(100dvh-4rem)] md:h-dvh",
						// While the thread panel's edge is dragged: no text selection, and frames never take the pointer.
						model.threadPanelDrag !== null &&
							"cursor-col-resize select-none [&_iframe]:pointer-events-none",
					),
				}),
			),
		],
		[
			h.div(
				[h.Class(contentStyles())],
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
						options.isMobile ?? false,
						h,
					]) ?? h.empty,
					lazyTabBar(chatTabBarView, [routeTabOf(model.tab), toSelf, h]) ?? h.empty,
					...(model.tab._tag === "Files"
						? [
								FilesView.view(h, model.tab.files, toFilesMessage, nowMs),
								FilesView.imageViewerOverlay(h, model.tab.files, toFilesMessage),
							]
						: messagesOutlet(h, model, nowMs)),
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
						threadPanelWidthOf(model),
						model.threadPanelDrag !== null,
						// Only what the panel's frames read: not the fullscreen dialog or the theme's variables.
						model.htmlRender.urls,
						model.htmlRender.frames,
						model.htmlRender.theme?.appearance ?? "dark",
						idleRowContext(h, model),
						h,
					]) ?? h.empty),
			// Outside the tabs: the list's frames and the thread panel's both open it.
			htmlRenderFullscreenView(h, model.htmlRender, toHtmlRenderMessage),
		],
	)
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
	width: number,
	isResizing: boolean,
	urls: HtmlRender.Model["urls"],
	frames: HtmlRender.Model["frames"],
	appearance: "light" | "dark",
	rowContext: RowContext<Message>,
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
		isGeneratingName: panel.isNaming,
		isCreating: panel.creation === "Creating",
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
