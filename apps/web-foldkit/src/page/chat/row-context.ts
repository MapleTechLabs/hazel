import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { menuHeaderBase } from "~/components/ui/menu.styles"
import {
	IconCopy,
	IconEdit,
	IconEmojiAdd,
	IconHashtag,
	IconReply,
	IconStar,
	IconThread,
	IconTrash,
	IconUnpin,
} from "../../icons"
import { avatarButton, type RowContext } from "../../chat/message/row"
import { TOP_EMOJIS } from "../../chat/message/toolbar"
import { popoverTrigger } from "../../chat/popover-host"
import { profilePopoverContent } from "../../chat/profile-popover"
import { button } from "../../ui/button"
import { contextMenuView, menuLabel } from "../../ui/menu-view"
import * as Overlays from "./overlays"
import { factsOf, Message, type Model } from "./channel/page"
import type { MessageRow } from "./rows"

/**
 * The context message rows render with. Rows are memoized by argument identity, so every row
 * without an open overlay shares one cached context; only the row owning an overlay gets its own.
 */

type ToParent<M> = (message: Message) => M

const overlaysMessage = <M>(toParentMessage: ToParent<M>, message: Overlays.Message) =>
	toParentMessage(Message.GotOverlaysMessage({ message }))

/** `ContextMenuHeader` with the quick reactions row. */
const contextMenuHeader = <M>(h: HtmlBuilder<M>): Html =>
	h.header(
		[h.Class(twMerge(menuHeaderBase, false, "flex items-center gap-1 px-1 py-1"))],
		TOP_EMOJIS.map((emoji) =>
			button(
				h,
				{
					size: "sq-md",
					intent: "plain",
					className: "p-1! text-lg hover:bg-secondary",
					attributes: [h.Attribute("aria-label", `React with ${emoji}`)],
				},
				[emoji],
			),
		),
	)

const contextItem = <M>(h: HtmlBuilder<M>, key: string, label: string, icon: Html): ReadonlyArray<Html> => [
	menuLabel(h, "message-context-menu", key, label),
	icon,
]

const contextMenuContent =
	<M>(h: HtmlBuilder<M>, isPinned: boolean) =>
	(key: string): ReadonlyArray<Html> => {
		const icon = (render: typeof IconCopy, className = "ml-auto size-4 text-muted-fg") =>
			render(h, { className, attributes: { "data-slot": "icon" } })
		if (key === "add-reaction") return contextItem(h, key, "Add Reaction", icon(IconEmojiAdd))
		if (key === "reply") return contextItem(h, key, "Reply", icon(IconReply))
		if (key === "edit") return contextItem(h, key, "Edit Message", icon(IconEdit))
		if (key === "thread") return contextItem(h, key, "Reply in Thread", icon(IconThread))
		if (key === "copy") return contextItem(h, key, "Copy Text", icon(IconCopy))
		if (key === "pin")
			return contextItem(
				h,
				key,
				isPinned ? "Unpin Message" : "Pin Message",
				icon(isPinned ? IconUnpin : IconStar),
			)
		if (key === "delete") return contextItem(h, key, "Delete Message", icon(IconTrash, "ml-auto size-4"))
		return contextItem(h, key, "Copy Message ID", icon(IconHashtag))
	}

const buildContext = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	toParentMessage: ToParent<M>,
	isIdle: boolean,
): RowContext<M> => {
	const users = model.lookups.users
	const names = new Map(users.map((user) => [user.id as string, `${user.firstName} ${user.lastName}`]))
	const overlays = model.overlays
	const toPopoverMessage = (
		key: string,
		message: Parameters<typeof Overlays.Message.GotPopoverMessage>[0]["message"],
	) => overlaysMessage(toParentMessage, Overlays.Message.GotPopoverMessage({ key, message }))
	return {
		tooltip: {
			active: isIdle ? null : overlays.tooltip,
			toMessage: (message) =>
				overlaysMessage(toParentMessage, Overlays.Message.GotTooltipMessage({ tooltip: message })),
			userName: (userId) => names.get(userId) ?? null,
			currentUserId: model.currentUserId,
		},
		toOpenImage: (messageId, index) =>
			overlaysMessage(toParentMessage, Overlays.Message.ClickedAttachmentImage({ messageId, index })),
		toOpenThread: (threadChannelId, messageId) =>
			overlaysMessage(
				toParentMessage,
				Overlays.Message.ClickedThreadPreview({ threadChannelId, messageId }),
			),
		contextMenu: (row, render) => {
			const open = isIdle ? null : overlays.contextMenu
			if (open === null || open.messageId !== row.message.id) return render([], h.empty)
			return h.submodel({
				slotId: "message-context-menu",
				model: open.menu,
				view: contextMenuView,
				viewInputs: {
					toTrigger: render,
					content: contextMenuContent(h, factsOf(model).isPinned(row.message.id)),
					className: "min-w-56",
					header: contextMenuHeader(h),
				},
				toParentMessage: (message) =>
					overlaysMessage(toParentMessage, Overlays.Message.GotContextMenuMessage({ message })),
			})
		},
		avatar: (row: MessageRow) =>
			popoverTrigger(h, {
				key: `${row.message.id}:avatar`,
				active: isIdle ? null : overlays.popover,
				toMessage: toPopoverMessage,
				placement: "right top",
				className: "w-72 p-0 lg:w-80",
				toTrigger: (attributes, overlay) => avatarButton(h, row, attributes, overlay),
				toContent: () => {
					const user = users.find((candidate) => candidate.id === row.message.authorId)
					if (user === undefined) return []
					return profilePopoverContent(h, {
						user,
						displayName: row.author.displayName,
						avatarUrl: row.author.avatarUrl,
						isBot: row.author.isBot,
						presence:
							model.lookups.presence.find((presence) => presence.userId === user.id) ?? null,
						isOwnProfile: model.currentUserId === user.id,
						nowMs: Date.now(),
					})
				},
			}),
	}
}

interface Cache<M> {
	readonly toParentMessage: ToParent<M>
	readonly users: Model["lookups"]["users"]
	readonly currentUserId: Model["currentUserId"]
	readonly context: RowContext<M>
}

let idleCache: Cache<never> | null = null

/** The shared context for rows without an open overlay. */
export const idleRowContext = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	toParentMessage: ToParent<M>,
): RowContext<M> => {
	const cache: Cache<M> | null = idleCache
	if (
		cache !== null &&
		cache.toParentMessage === toParentMessage &&
		cache.users === model.lookups.users &&
		cache.currentUserId === model.currentUserId
	)
		return cache.context
	const context = buildContext(h, model, toParentMessage, true)
	const next: Cache<M> = {
		toParentMessage,
		users: model.lookups.users,
		currentUserId: model.currentUserId,
		context,
	}
	idleCache = next as Cache<never>
	return context
}

/** The context for one row: the idle one, unless an overlay belongs to this message. */
export const rowContextFor = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	row: MessageRow,
	toParentMessage: ToParent<M>,
	idle: RowContext<M>,
): RowContext<M> =>
	Overlays.ownsRow(model.overlays, row.message.id) ? buildContext(h, model, toParentMessage, false) : idle
