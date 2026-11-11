import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import * as MessageList from "../../../mount/message-list"
import { PAGE_SIZE } from "../queries"
import { Message, type Model, type PageReturn } from "./model"

/** The loaded message window: how far it reaches back, and paging at its edges (read and write path). */

/** The most messages the window holds (S2 condition 1); past it, older pages slide the window. */
export const MAX_WINDOW = 10 * PAGE_SIZE

/** Folds a list step back into the page. */
export const liftList = (model: Model, result: MessageList.ListReturn): PageReturn => ({
	// An unchanged list keeps the page reference, so ignored events cost no render.
	model: result.model === model.list ? model : modifyFields(model, { list: () => result.model }),
	commands: Command.mapMessages(result.commands, (message) => Message.GotListMessage({ message })),
})

/** Only a window that reaches the newest message follows the end. */
const withWindowFollow = (model: Model): Model => {
	const list = MessageList.setCanFollowEnd(model.list, model.offset === 0)
	return list === model.list ? model : modifyFields(model, { list: () => list })
}

/**
 * Grows the window by a page near the oldest message, then slides it; near the end it slides back.
 * Only while the list is on screen: a hidden list's offsets describe no reader.
 */
export const loadWhenNearEdge = (result: PageReturn): PageReturn => {
	const { model } = result
	if (model.tab._tag !== "Messages") return result
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
			model: withWindowFollow(
				modifyFields(model, { offset: (offset) => Math.max(0, offset - PAGE_SIZE) }),
			),
		}
	return result
}

/**
 * Moves the window over the message that has `newerCount` newer ones, with half a page older than it:
 * grown from the newest message while that fits `MAX_WINDOW`, else slid so the message is mid-window.
 */
export const windowAround = (model: Model, newerCount: number): Model => {
	const needed = newerCount + 1 + PAGE_SIZE / 2
	const next =
		needed <= MAX_WINDOW
			? { offset: 0, limit: Math.max(model.limit, Math.ceil(needed / PAGE_SIZE) * PAGE_SIZE) }
			: {
					offset: Math.floor((newerCount - MAX_WINDOW / 2) / PAGE_SIZE) * PAGE_SIZE,
					limit: MAX_WINDOW,
				}
	return next.offset === model.offset && next.limit === model.limit
		? model
		: withWindowFollow(modifyFields(model, { offset: () => next.offset, limit: () => next.limit }))
}

/** Back to the newest page (after sending from a scrolled-back window). */
export const resetWindow = (model: Model): Model =>
	model.offset === 0
		? model
		: withWindowFollow(modifyFields(model, { offset: () => 0, limit: () => PAGE_SIZE }))
