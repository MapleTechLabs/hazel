import { createLazy, type Html, type HtmlBuilder } from "foldkit/html"
import { contentStyles, rootStyles } from "~/components/ui/split-panel/split-panel.styles"
import { isImageAttachment } from "../../../chat/attachments"
import { imageViewerView } from "../../../chat/image-viewer"
import { dateDividerView, messageRowView, type RowContext } from "../../../chat/message/row"
import * as MessageList from "../../../mount/message-list"
import { joinBannerView, typingIndicatorView, typingUsersOf } from "../banners"
import { authorIdentity } from "../derive"
import * as FilesView from "../files/view"
import { mobileMenuButton } from "../../../shell/mobile"
import { chatHeaderView } from "../header"
import { pinnedPopoverView } from "../pinned"
import { messageToolbarOverlay, reactionModalView, trackHoverAttribute } from "../overlay-views"
import { attachmentInfoFrom, composerAreaView, replyPreviewOf } from "../composer-view"
import type * as Draft from "../../../composer/draft"
import { draftView } from "../../../composer/draft-view"
import * as Overlays from "../overlays"
import { deriveContextOf, isMemberOf, Message, type Model } from "./page"
import { idleRowContext, rowContextFor } from "../row-context"
import type { DisplayRow } from "../rows"
import { chatTabBarView } from "../tab-bar"
import { threadPanelView } from "../thread-panel"

/** The channel route's content: header, tab bar, message list and composer (desktop). */

/** One memo slot per rendered row; slots of rows that scroll away are dropped. */
const rowSlots = new Map<string, ReturnType<typeof createLazy>>()
const renderedThisFrame = new Set<string>()
const MAX_IDLE_SLOTS = 200

const rowView = <M>(row: DisplayRow, isStuck: boolean, context: RowContext<M>, h: HtmlBuilder<M>): Html =>
	row._tag === "DateHeader" ? dateDividerView(h, row.label, isStuck) : messageRowView(h, row, context)

const memoRow = <M>(h: HtmlBuilder<M>, row: DisplayRow, isStuck: boolean, context: RowContext<M>): Html => {
	let slot = rowSlots.get(row.key)
	if (slot === undefined) rowSlots.set(row.key, (slot = createLazy()))
	renderedThisFrame.add(row.key)
	return slot(rowView, [row, isStuck, context, h]) ?? h.div([], [])
}

const pruneRowSlots = () => {
	if (rowSlots.size > renderedThisFrame.size + MAX_IDLE_SLOTS)
		for (const key of rowSlots.keys()) if (!renderedThisFrame.has(key)) rowSlots.delete(key)
	renderedThisFrame.clear()
}

/** `MessageList`'s empty state. */
const emptyStateView = <M>(h: HtmlBuilder<M>): Html =>
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

const messageListView = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	toParentMessage: (message: Message) => M,
	nowMs: number,
): Html => {
	if (!model.hasLoadedMessages) return h.div([], [])
	if (model.messages.length === 0) return emptyStateView(h)
	const idle = idleRowContext(h, model, toParentMessage)
	const list = MessageList.view(h, model.list, {
		items: model.rows,
		itemToKey: (row) => row.key,
		itemToView: (row, { isStuck }) =>
			memoRow(
				h,
				row,
				isStuck,
				row._tag === "MessageRow" ? rowContextFor(h, model, row, toParentMessage, idle, nowMs) : idle,
			),
		isStickyHeader: (row) => row._tag === "DateHeader",
		toParentMessage: (message) => toParentMessage(Message.GotListMessage({ message })),
	})
	pruneRowSlots()
	// Keyed: the not-yet-loaded placeholder is also a div, and a reused element never runs OnMount.
	return h.keyed("div")(
		"message-list-container",
		[
			h.Class(
				"isolate flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2 transition-opacity duration-200",
			),
			h.Attribute("style", "overflow-anchor: auto; scroll-behavior: auto; opacity: 1;"),
			trackHoverAttribute(h, toParentMessage),
		],
		[
			// The legacy hover highlight is injected CSS, so it holds while the toolbar is hovered.
			model.overlays.hoveredMessageId === null
				? h.empty
				: h.style(
						[],
						[
							`#message-${model.overlays.hoveredMessageId} { background-color: var(--color-secondary) !important; }`,
						],
					),
			list,
		],
	)
}

/** `ImageViewerModal` for the message whose attachment was clicked. */
const imageViewerOverlay = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	toParentMessage: (message: Message) => M,
): Html => {
	const viewer = model.overlays.imageViewer
	if (viewer === null) return h.empty
	const row = model.rows.find((candidate) => candidate.key === viewer.messageId)
	if (row === undefined || row._tag !== "MessageRow") return h.empty
	const overlays = (message: Overlays.Message) => toParentMessage(Message.GotOverlaysMessage({ message }))
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
		toClose: () => overlays(Overlays.Message.ClosedImageViewer()),
		toSelect: (index) => overlays(Overlays.Message.SelectedViewerImage({ index })),
		toAction: (action, image) =>
			overlays(Overlays.Message.ClickedViewerAction({ action, url: image.url, fileName: image.fileName })),
	})
}

/** `$id/index.tsx`: the join banner for non-members, else the list and the composer. */
const messagesOutlet = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	toParentMessage: (message: Message) => M,
	nowMs: number,
) => {
	const isMember = isMemberOf(model)
	if (isMember === false) return [joinBannerView(h, model.channel)]
	const typingUsers = typingUsersOf(
		model.typing,
		model.members,
		model.lookups.users,
		model.currentUserId,
		model.typingNowMs,
	)
	// Passed to the lazy composer as strings, so an unchanged reply keeps its memo.
	const reply = replyPreviewOf(model, model.draft)
	return [
		h.div(
			[h.Class("flex min-h-0 flex-1 flex-col overflow-hidden")],
			[messageListView(h, model, toParentMessage, nowMs)],
		),
		lazyComposer(composerView, [
			typingUsers.length === 0 ? null : typingUsers.map((user) => user.firstName).join(),
			model.draft,
			reply?.authorName ?? null,
			reply?.firstLine ?? null,
			model.lookups.attachments,
			toParentMessage,
			h,
		]) ?? h.empty,
		imageViewerOverlay(h, model, toParentMessage),
		messageToolbarOverlay(h, model, toParentMessage),
		reactionModalView(h, model, toParentMessage),
	]
}

const composerView = <M>(
	typingKey: string | null,
	draft: Draft.Model,
	replyAuthorName: string | null,
	replyFirstLine: string | null,
	attachments: Model["lookups"]["attachments"],
	toParentMessage: (message: Message) => M,
	h: HtmlBuilder<M>,
) =>
	composerAreaView(
		h,
		typingKey === null
			? null
			: typingIndicatorView(
					h,
					typingKey.split(",").map((firstName) => ({ firstName })),
				),
		draft,
		{
			toMessage: toDraftMessage(toParentMessage),
			replyPreview:
				replyAuthorName === null || replyFirstLine === null
					? null
					: { authorName: replyAuthorName, firstLine: replyFirstLine },
			attachmentInfo: attachmentInfoFrom(attachments),
		},
	)

/** One mapping function per parent mapping, so the composer's lazy arguments stay equal. */
const draftMappers = new WeakMap<object, (message: Draft.Message) => unknown>()
const toDraftMessage = <M>(toParentMessage: (message: Message) => M): ((message: Draft.Message) => M) => {
	const cached = draftMappers.get(toParentMessage)
	if (cached) return cached as (message: Draft.Message) => M
	const mapper = (message: Draft.Message) => toParentMessage(Message.GotDraftMessage({ message }))
	draftMappers.set(toParentMessage, mapper)
	return mapper
}

const headerView = <M>(
	channel: Model["channel"],
	parentChannel: Model["parentChannel"],
	orgSlug: Model["orgSlug"],
	members: Model["members"],
	lookups: Model["lookups"],
	currentUserId: Model["currentUserId"],
	pinnedPopover: Model["overlays"]["pinned"],
	pins: Model["pinned"],
	isMobile: boolean,
	toParentMessage: (message: Message) => M,
	h: HtmlBuilder<M>,
): Html => {
	const model = { lookups, members, currentUserId }
	const users = new Map(model.lookups.users.map((user) => [user.id, user]))
	const botNames = new Map(model.lookups.bots.map((bot) => [bot.userId, bot.name]))
	const others = (model.members ?? []).filter((member) => member.userId !== model.currentUserId)
	const currentMember = (model.members ?? []).find((member) => member.userId === model.currentUserId)
	return chatHeaderView(h, {
		channel,
		parentChannel,
		orgSlug: orgSlug ?? "",
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
						onPress: h.OnClick(toParentMessage(Message.ClickedMobileMenu())),
						...(className === undefined ? {} : { className }),
					})
				: h.empty,
		pinnedTrigger: pinnedPopoverView(h, pinnedPopover, pins, (message) =>
			toParentMessage(
				Message.GotOverlaysMessage({ message: Overlays.Message.GotPinnedMessage({ message }) }),
			),
		),
	})
}

// The chrome around the list only changes with the channel, not on every scroll frame.
const lazyHeader = createLazy()
const lazyTabBar = createLazy()
const lazyComposer = createLazy()

/** `SplitPanelRoot` > `SplitPanelContent` with the channel's current tab inside. */
export const view = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	toParentMessage: (message: Message) => M,
	isMobile = false,
	/** `Shared.nowMs`, the presence clock the profile popover reads. */
	nowMs = 0,
): Html =>
	// Keyed by channel like React's `key={id}`: Mounts start on insert only, so a patched-in-place
	// page would keep the previous channel's list observer and never measure the new viewport.
	h.keyed("div")(
		model.channelId,
		[h.Class(rootStyles({ className: "h-[calc(100dvh-4rem)] md:h-dvh" }))],
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
						isMobile,
						toParentMessage,
						h,
					]) ?? h.empty,
					lazyTabBar(chatTabBarView, [model.tab, toParentMessage, h]) ?? h.empty,
					...(model.tab === "messages" || model.files === null
						? messagesOutlet(h, model, toParentMessage, nowMs)
						: [
								FilesView.view(h, model.files, (message) =>
									toParentMessage(Message.GotFilesMessage({ message })),
								),
							]),
				],
			),
			threadPanelOverlay(h, model, toParentMessage),
		],
	)

/** The `SplitPanel` beside the channel while a thread is open. */
const threadPanelOverlay = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	toParentMessage: (message: Message) => M,
): Html => {
	const thread = model.overlays.thread
	if (thread === null) return h.empty
	const name = model.lookups.threadChannels.find((channel) => channel.id === thread.threadChannelId)?.name
	return threadPanelView(h, {
		threadName: name || "Thread",
		original: model.messages.find((message) => message.id === thread.messageId) ?? null,
		messages: model.threadMessages,
		context: deriveContextOf(model),
		rowContext: idleRowContext(h, model, toParentMessage),
		onClose: toParentMessage(Message.GotOverlaysMessage({ message: Overlays.Message.ClosedThread() })),
		onGenerateName: toParentMessage(Message.ClickedGenerateThreadName()),
		onRename: toParentMessage(Message.ClickedRenameThread()),
		isGeneratingName: model.isGeneratingThreadName,
		isCreating: model.pendingThreadChannelId === thread.threadChannelId,
		composer:
			model.threadDraft === null
				? h.empty
				: draftView(h, model.threadDraft, {
						toMessage: (message) => toParentMessage(Message.GotThreadDraftMessage({ message })),
						replyPreview: replyPreviewOf(model, model.threadDraft),
						attachmentInfo: attachmentInfoFrom(model.lookups.attachments),
					}),
	})
}
