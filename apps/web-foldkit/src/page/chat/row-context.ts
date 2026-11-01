import type { ChannelId, MessageId } from "@hazel/schema"
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
import type * as HtmlRender from "../../chat/html-render"
import { avatarButton, type RowContext } from "../../chat/message/row"
import { TOP_EMOJIS } from "../../chat/message/toolbar"
import { popoverTrigger } from "../../chat/popover-host"
import { profilePopoverContent } from "../../chat/profile-popover"
import type * as TooltipHost from "../../chat/tooltip-host"
import { button } from "../../ui/button"
import type * as Menu from "../../ui/menu"
import { contextMenuView, menuLabel } from "../../ui/menu-view"
import type * as Popover from "../../ui/popover"
import * as Overlays from "./overlays"
import { factsOf, Message, type Model } from "./channel/page"
import { authorIdentity } from "./derive"
import type { MessageRow } from "./rows"

/**
 * The context message rows render with. Rows are memoized by argument identity, so every row
 * without an open overlay shares one context per user list; only the row owning an overlay gets its own.
 */

type H = HtmlBuilder<Message>

// The page's mappers, built once: a row context made of them compares equal across renders.

const toOverlays = (message: Overlays.Message) => Message.GotOverlaysMessage({ message })

const toTooltipMessage = (message: TooltipHost.Message) =>
	toOverlays(Overlays.Message.GotTooltipMessage({ message }))

const toOpenImage = (messageId: MessageId, index: number) =>
	toOverlays(Overlays.Message.ClickedAttachmentImage({ messageId, index }))

const toOpenEmbedImage = (
	messageId: MessageId,
	images: ReadonlyArray<Overlays.ViewerUrlImage>,
	index: number,
) => toOverlays(Overlays.Message.ClickedEmbedImage({ messageId, images, index }))

const toReact = (messageId: MessageId, emoji: string) =>
	toOverlays(Overlays.Message.ClickedReaction({ messageId, emoji }))

const toOpenThread = (threadChannelId: ChannelId, messageId: MessageId) =>
	Message.ClickedThreadPreview({ threadChannelId, messageId })

const toHtmlRenderMessage = (message: HtmlRender.Message) => Message.GotHtmlRenderMessage({ message })

const toPressEmbedAction = (channelId: ChannelId, messageId: MessageId, actionId: string) =>
	Message.ClickedEmbedAction({ channelId, messageId, actionId })

const toPopoverMessage = (messageId: MessageId) => (key: string, message: Popover.Message) =>
	toOverlays(Overlays.Message.GotPopoverMessage({ messageId, key, message }))

/** A mention's profile popover opens below the mention. */
const MENTION_POPOVER = { placement: "bottom start", className: "w-72 p-0 lg:w-80" } as const

const toContextMenuMessage = (message: Menu.Message) =>
	toOverlays(Overlays.Message.GotContextMenuMessage({ message }))

/** `ContextMenuHeader` with the quick reactions row. */
const contextMenuHeader = (h: H, messageId: MessageId): Html =>
	h.header(
		[h.Class(twMerge(menuHeaderBase, false, "flex items-center gap-1 px-1 py-1"))],
		TOP_EMOJIS.map((emoji) =>
			button(
				h,
				{
					size: "sq-md",
					intent: "plain",
					className: "p-1! text-lg hover:bg-secondary",
					onPress: toReact(messageId, emoji),
					attributes: [h.Attribute("aria-label", `React with ${emoji}`)],
				},
				[emoji],
			),
		),
	)

const contextItem = (h: H, key: string, label: string, icon: Html): ReadonlyArray<Html> => [
	menuLabel(h, "message-context-menu", key, label),
	icon,
]

const contextMenuContent =
	(h: H, isPinned: boolean) =>
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

const userNamesOf = (users: Model["lookups"]["users"]) =>
	new Map(users.map((user) => [user.id as string, `${user.firstName} ${user.lastName}`]))

/** The context of a row without an open overlay: no tooltip, menu or popover is ever open in it. */
const buildIdleContext = (
	h: H,
	users: Model["lookups"]["users"],
	currentUserId: Model["currentUserId"],
): RowContext<Message> => {
	const names = userNamesOf(users)
	return {
		tooltip: {
			active: null,
			hoveredKey: null,
			toMessage: toTooltipMessage,
			userName: (userId) => names.get(userId) ?? null,
			currentUserId,
		},
		toOpenImage,
		toOpenEmbedImage,
		toReact,
		toOpenThread,
		toHtmlRenderMessage,
		toPressEmbedAction,
		contextMenu: (_row, render) => render([], h.empty),
		avatar: (row: MessageRow) =>
			popoverTrigger(h, {
				key: Overlays.avatarPopoverKey(row.message.id),
				active: null,
				toMessage: toPopoverMessage(row.message.id),
				placement: "right top",
				className: "w-72 p-0 lg:w-80",
				toTrigger: (attributes) => avatarButton(h, row, attributes),
				toContent: () => [],
			}),
		mention: (row) => (mention, toTrigger) =>
			popoverTrigger(h, {
				key: Overlays.mentionPopoverKey(row.message.id, mention.index),
				active: null,
				toMessage: toPopoverMessage(row.message.id),
				...MENTION_POPOVER,
				toTrigger,
				toContent: () => [],
			}),
	}
}

/** The context of the row an overlay belongs to: the open tooltip, context menu or profile popover. */
const buildOwnerContext = (h: H, model: Model, nowMs: number): RowContext<Message> => {
	const users = model.lookups.users
	const names = userNamesOf(users)
	const overlays = model.overlays
	const contextMenu = Overlays.contextMenuOf(overlays)
	const profileOf = (userId: string): ReadonlyArray<Html> => {
		const user = users.find((candidate) => candidate.id === userId)
		if (user === undefined) return []
		const identity = authorIdentity(user, model.lookups.bots.find((bot) => bot.userId === user.id)?.name)
		return profilePopoverContent(h, {
			user,
			...identity,
			presence: model.lookups.presence.find((presence) => presence.userId === user.id) ?? null,
			isOwnProfile: model.currentUserId === user.id,
			nowMs,
		})
	}
	return {
		tooltip: {
			active: Overlays.activeTooltipOf(overlays),
			hoveredKey: overlays.hoveredTrigger?.key ?? null,
			toMessage: toTooltipMessage,
			userName: (userId) => names.get(userId) ?? null,
			currentUserId: model.currentUserId,
		},
		toOpenImage,
		toOpenEmbedImage,
		toReact,
		toOpenThread,
		toHtmlRenderMessage,
		toPressEmbedAction,
		contextMenu: (row, render) =>
			contextMenu === null || contextMenu.messageId !== row.message.id
				? render([], h.empty)
				: h.submodel({
						slotId: "message-context-menu",
						model: contextMenu.menu,
						view: contextMenuView,
						viewInputs: {
							entries: Overlays.contextMenuEntries(factsOf(model), row.message.id),
							toTrigger: render,
							content: contextMenuContent(h, factsOf(model).isPinned(row.message.id)),
							className: "min-w-56",
							header: () => contextMenuHeader(h, row.message.id),
						},
						toParentMessage: toContextMenuMessage,
					}),
		avatar: (row: MessageRow) =>
			popoverTrigger(h, {
				key: Overlays.avatarPopoverKey(row.message.id),
				active: Overlays.activePopoverOf(overlays),
				toMessage: toPopoverMessage(row.message.id),
				placement: "right top",
				className: "w-72 p-0 lg:w-80",
				toTrigger: (attributes) => avatarButton(h, row, attributes),
				toContent: () => profileOf(row.message.authorId),
			}),
		mention: (row) => (mention, toTrigger) =>
			popoverTrigger(h, {
				key: Overlays.mentionPopoverKey(row.message.id, mention.index),
				active: Overlays.activePopoverOf(overlays),
				toMessage: toPopoverMessage(row.message.id),
				...MENTION_POPOVER,
				toTrigger,
				toContent: () => profileOf(mention.userId),
			}),
	}
}

// A pure view memo keyed by the (frozen) user list, like `MessageList.layoutOf`: the same Model
// always yields the same idle context, so rendering it twice gives the same result.
const idleContexts = new WeakMap<
	Model["lookups"]["users"],
	Map<Model["currentUserId"], RowContext<Message>>
>()

/** The shared context for rows without an open overlay. */
export const idleRowContext = (h: H, model: Model): RowContext<Message> => {
	const byUser =
		idleContexts.get(model.lookups.users) ?? new Map<Model["currentUserId"], RowContext<Message>>()
	const cached = byUser.get(model.currentUserId)
	if (cached !== undefined) return cached
	const context = buildIdleContext(h, model.lookups.users, model.currentUserId)
	byUser.set(model.currentUserId, context)
	idleContexts.set(model.lookups.users, byUser)
	return context
}

/** The context for one row: the idle one, unless an overlay belongs to this message. */
export const rowContextFor = (
	h: H,
	model: Model,
	row: MessageRow,
	idle: RowContext<Message>,
	nowMs: number,
): RowContext<Message> =>
	Overlays.ownsRow(model.overlays, row.message.id) ? buildOwnerContext(h, model, nowMs) : idle
