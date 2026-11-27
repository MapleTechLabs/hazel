import { hole } from "../../../app/holes"
import { createLazy, type Html, type HtmlBuilder } from "foldkit/html"
import { cn } from "~/lib/utils"
import { splitContentClassName, splitRootClassName } from "../../../ui/split-panel"
import { htmlRenderFullscreenView } from "../../../chat/embeds/html-render"
import type * as HtmlRender from "../../../chat/html-render"
import { imageViewerView } from "../../../chat/image-viewer"
import type { RowContext } from "../../../chat/message/row"
import type * as Draft from "../../../composer/draft"
import { draftView } from "../../../composer/draft-view"
import { typingIndicatorView } from "../banners"
import { attachmentInfoFrom, composerAreaView, replyPreviewOf } from "../composer-view"
import { toDeriveContext } from "../derive"
import { messageToolbarOverlay, reactionModalView, trackHoverAttribute } from "../overlay-views"
import * as Overlays from "../overlays"
import { threadRowContextFor } from "../row-context"
import type { MessageRow } from "../rows"
import { chatTabBarView } from "../tab-bar"
import { threadPanelView } from "../thread-panel"
import * as IssueControl from "../issue-control"
import { AppRoute, hrefOf } from "../../../route"
import { isMemberOf, Message, type Model, routeTabOf, type ThreadPanel } from "./page"
import { threadPanelWidthOf } from "./thread-width"
import { openViewerOf } from "./viewer-images"

/** The channel route's content: header, tab bar, message list and composer (desktop). */

type H = HtmlBuilder<Message>

// The page's mappers, built once, so the lazy views that take them keep their memo.

const toSelf = (message: Message) => message
const toDraftMessage = (message: Draft.Message) => Message.GotDraftMessage({ message })
const toThreadDraftMessage = (message: Draft.Message) => Message.GotThreadDraftMessage({ message })
const toOverlay = (message: Overlays.Message) => Message.GotOverlaysMessage({ message })
const toHtmlRenderMessage = (message: HtmlRender.Message) => Message.GotHtmlRenderMessage({ message })
const toPressEdge = (clientX: number, startWidth: number, maxWidth: number) =>
	Message.PressedThreadPanelEdge({ clientX, startWidth, maxWidth })
const toNudgeEdge = (delta: number) => Message.PressedThreadPanelEdgeKey({ delta })
const toIssueControlMessage = (message: IssueControl.Message) => Message.GotIssueControlMessage({ message })

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
const messagesOutlet = (h: H, model: Model, nowMs: number) => {
	// The shared join banner (`src/root/app.ts`) fills its hole.
	if (isMemberOf(model) === false)
		return model.channel === null
			? []
			: [hole(h, "join-banner", model.channelId, [h.Class("flex flex-1 flex-col")])]
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
					// The channel header is the shared screen in its hole (`src/root/app.ts`).
					hole(h, "channel-header", model.channelId, [h.Class("shrink-0")]),
					lazyTabBar(chatTabBarView, [routeTabOf(model.tab), toSelf, h]) ?? h.empty,
					...(model.tab._tag === "Files"
						? [filesHole(h, model, model.tab.view)]
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
