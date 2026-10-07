import { createLazy, type Html, type HtmlBuilder } from "foldkit/html"
import { contentStyles, rootStyles } from "~/components/ui/split-panel/split-panel.styles"
import { isImageAttachment } from "../../chat/attachments"
import { imageViewerView } from "../../chat/image-viewer"
import { dateDividerView, messageRowView, type RowContext } from "../../chat/message/row"
import * as MessageList from "../../mount/message-list"
import { joinBannerView, typingIndicatorView, typingUsersOf } from "./banners"
import { composerPlaceholderView } from "./composer-placeholder"
import { authorIdentity } from "./derive"
import * as FilesView from "./files/view"
import { chatHeaderView, pinnedButton } from "./header"
import {
	deleteMessageModal,
	messageToolbarOverlay,
	type ReplyPreview,
	replyIndicatorView,
	replyPreviewOf,
	trackHoverAttribute,
} from "./overlay-views"
import * as Overlays from "./overlays"
import { isMemberOf, Message, type Model } from "./page"
import { idleRowContext, rowContextFor } from "./row-context"
import type { DisplayRow } from "./rows"
import { chatTabBarView } from "./tab-bar"

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
				row._tag === "MessageRow" ? rowContextFor(h, model, row, toParentMessage, idle) : idle,
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
		images: row.attachments.filter(isImageAttachment),
		index: viewer.index,
		author: row.message.author
			? {
					name: `${row.message.author.firstName} ${row.message.author.lastName}`,
					avatarUrl: row.message.author.avatarUrl,
				}
			: null,
		createdAtMs: row.message.createdAtMs,
		toClose: () => overlays(Overlays.Message.ClosedImageViewer()),
		toSelect: (index) => overlays(Overlays.Message.SelectedViewerImage({ index })),
	})
}

/** `$id/index.tsx`: the join banner for non-members, else the list and the composer. */
const messagesOutlet = <M>(h: HtmlBuilder<M>, model: Model, toParentMessage: (message: Message) => M) => {
	const isMember = isMemberOf(model)
	if (isMember === false) return [joinBannerView(h, model.channel)]
	const typingUsers = typingUsersOf(
		model.typing,
		model.members,
		model.lookups.users,
		model.currentUserId,
		model.typingNowMs,
	)
	return [
		h.div(
			[h.Class("flex min-h-0 flex-1 flex-col overflow-hidden")],
			[messageListView(h, model, toParentMessage)],
		),
		lazyComposer(composerView, [
			typingUsers.length === 0 ? null : typingUsers.map((user) => user.firstName).join(),
			replyPreviewOf(model),
			toParentMessage,
			h,
		]) ?? h.empty,
		imageViewerOverlay(h, model, toParentMessage),
		messageToolbarOverlay(h, model, toParentMessage),
		deleteMessageModal(h, model, toParentMessage),
	]
}

const composerView = <M>(
	typingKey: string | null,
	reply: ReplyPreview | null,
	toParentMessage: (message: Message) => M,
	h: HtmlBuilder<M>,
) =>
	composerPlaceholderView(
		h,
		reply === null ? null : replyIndicatorView(h, reply, toParentMessage),
		typingKey === null
			? null
			: typingIndicatorView(
					h,
					typingKey.split(",").map((firstName) => ({ firstName })),
				),
	)

const headerView = <M>(
	channel: Model["channel"],
	parentChannel: Model["parentChannel"],
	orgSlug: Model["orgSlug"],
	members: Model["members"],
	lookups: Model["lookups"],
	currentUserId: Model["currentUserId"],
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
		pinnedTrigger: pinnedButton(h, [h.Attribute("aria-expanded", "false")], h.empty),
	})
}

// The chrome around the list only changes with the channel, not on every scroll frame.
const lazyHeader = createLazy()
const lazyTabBar = createLazy()
const lazyComposer = createLazy()

/** `SplitPanelRoot` > `SplitPanelContent` with the channel's current tab inside. */
export const view = <M>(h: HtmlBuilder<M>, model: Model, toParentMessage: (message: Message) => M): Html =>
	h.div(
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
						h,
					]) ?? h.empty,
					lazyTabBar(chatTabBarView, [model.tab, toParentMessage, h]) ?? h.empty,
					...(model.tab === "messages" || model.files === null
						? messagesOutlet(h, model, toParentMessage)
						: [
								FilesView.view(h, model.files, (message) =>
									toParentMessage(Message.GotFilesMessage({ message })),
								),
							]),
				],
			),
		],
	)
