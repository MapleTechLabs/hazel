import type { HtmlBuilder } from "foldkit/html"
import { avatarButton, type RowContext } from "../../chat/message/row"
import type * as TooltipHost from "../../chat/tooltip-host"
import type { UserInfo } from "./lookups"
import * as Overlays from "./overlays"
import { Message, type Model } from "./page"
import type { MessageRow } from "./rows"

/**
 * The context message rows render with. Rows are memoized by argument identity, so every row
 * without an open overlay shares one cached context; only the row owning an overlay gets its own.
 */

type ToParent<M> = (message: Message) => M

interface Cache<M> {
	readonly toParentMessage: ToParent<M>
	readonly users: ReadonlyArray<UserInfo>
	readonly currentUserId: string | null
	readonly overlays: Model["overlays"] | null
	readonly context: RowContext<M>
}

let idleCache: Cache<unknown> | null = null

const overlaysMessage = <M>(toParentMessage: ToParent<M>, message: Overlays.Message) =>
	toParentMessage(Message.GotOverlaysMessage({ message }))

const buildContext = <M>(
	h: HtmlBuilder<M>,
	toParentMessage: ToParent<M>,
	users: ReadonlyArray<UserInfo>,
	currentUserId: string | null,
	tooltip: TooltipHost.Model,
): RowContext<M> => {
	const names = new Map(users.map((user) => [user.id as string, `${user.firstName} ${user.lastName}`]))
	return {
		tooltip: {
			active: tooltip,
			toMessage: (message) =>
				overlaysMessage(toParentMessage, Overlays.Message.GotTooltipMessage({ tooltip: message })),
			userName: (userId) => names.get(userId) ?? null,
			currentUserId,
		},
		toOpenImage: (messageId, index) =>
			overlaysMessage(toParentMessage, Overlays.Message.ClickedAttachmentImage({ messageId, index })),
		toOpenThread: (threadChannelId, messageId) =>
			overlaysMessage(
				toParentMessage,
				Overlays.Message.ClickedThreadPreview({ threadChannelId, messageId }),
			),
		contextMenuTrigger: () => [],
		contextMenuOverlay: () => h.empty,
		avatarTrigger: (row: MessageRow, overlay) => avatarButton(h, row, [], overlay),
	}
}

/** The shared context for rows without an open overlay. */
export const idleRowContext = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	toParentMessage: ToParent<M>,
): RowContext<M> => {
	const cache = idleCache as Cache<M> | null
	if (
		cache !== null &&
		cache.toParentMessage === toParentMessage &&
		cache.users === model.lookups.users &&
		cache.currentUserId === model.currentUserId
	)
		return cache.context
	const context = buildContext(h, toParentMessage, model.lookups.users, model.currentUserId, null)
	idleCache = {
		toParentMessage,
		users: model.lookups.users,
		currentUserId: model.currentUserId,
		overlays: null,
		context,
	} as Cache<unknown>
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
	Overlays.ownsRow(model.overlays, row.message.id)
		? buildContext(h, toParentMessage, model.lookups.users, model.currentUserId, model.overlays.tooltip)
		: idle
