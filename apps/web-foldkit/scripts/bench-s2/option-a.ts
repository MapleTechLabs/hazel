import { messageCollection, messageReactionCollection } from "~/db/collections"
import * as Data from "../../src/page/chat/data.ts"
import * as Page from "../../src/page/chat/page.ts"
import {
	channelId,
	currentUserId,
	deepFreeze,
	freshId,
	median,
	newMessageRow,
	round,
	subscribe,
	time,
} from "./shared.ts"

/**
 * Option (a): the live TanStack DB queries emit the full result on every change; the page re-derives
 * its rows. `dataMs` covers the collection write through the emitted, validated Message.
 */

export const runA = async (limit: number, samples: number) => {
	let constructMs = 0
	const messages = subscribe(
		Data.messagesStream(channelId, limit, (rows) => {
			const [message, ms] = time(() => Page.Message.UpdatedMessages({ messages: rows }))
			constructMs = ms
			return message
		}),
	)
	const reactions = subscribe(
		Data.reactionsStream(channelId, (rows) => Page.Message.UpdatedReactions({ reactions: rows })),
	)

	const started = performance.now()
	const firstMessages = await messages.next()
	const initialDataMs = performance.now() - started
	const initialConstructMs = constructMs
	const firstReactions = await reactions.next()
	let [page, initialUpdateMs] = time(() => {
		const withMessages = Page.update(Page.init(channelId, currentUserId), firstMessages).model
		return Page.update(withMessages, firstReactions).model
	})
	const [, initialFreezeMs] = time(() => deepFreeze(page))

	const message = {
		data: [] as number[],
		construct: [] as number[],
		update: [] as number[],
		freeze: [] as number[],
	}
	for (let index = 0; index < samples; index++) {
		const begin = performance.now()
		messageCollection.insert(newMessageRow(index))
		const emitted = await messages.next()
		message.data.push(performance.now() - begin)
		message.construct.push(constructMs)
		const [next, updateMs] = time(() => Page.update(page, emitted).model)
		message.update.push(updateMs)
		message.freeze.push(time(() => deepFreeze(next))[1])
		page = next
	}

	const reaction = { data: [] as number[], update: [] as number[], freeze: [] as number[] }
	const target = page.messages[0]!
	for (let index = 0; index < samples; index++) {
		const id = freshId()
		for (const write of [
			() =>
				messageReactionCollection.insert({
					id,
					messageId: target.id,
					channelId,
					conversationId: null,
					userId: currentUserId,
					emoji: "🚀",
					createdAt: new Date(),
				}),
			() => messageReactionCollection.delete(id),
		]) {
			const begin = performance.now()
			write()
			const emitted = await reactions.next()
			reaction.data.push(performance.now() - begin)
			const [next, updateMs] = time(() => Page.update(page, emitted).model)
			reaction.update.push(updateMs)
			reaction.freeze.push(time(() => deepFreeze(next))[1])
			page = next
		}
	}
	await messages.stop()
	await reactions.stop()

	return {
		initialMs: round(initialDataMs + initialUpdateMs),
		"initial data/construct/update/freeze": [
			initialDataMs,
			initialConstructMs,
			initialUpdateMs,
			initialFreezeMs,
		]
			.map(round)
			.join(" / "),
		newMessageMs: round(median(message.data) + median(message.update)),
		"msg data/construct/update/freeze": [message.data, message.construct, message.update, message.freeze]
			.map(median)
			.join(" / "),
		reactionToggleMs: round(median(reaction.data) + median(reaction.update)),
		"reaction data/update/freeze": [reaction.data, reaction.update, reaction.freeze]
			.map(median)
			.join(" / "),
	}
}

/** Everything option (a) keeps alive for one open channel: seeded collections, live queries, the page. */
export const setupForHeap = async (limit: number) => {
	const messages = subscribe(
		Data.messagesStream(channelId, limit, (rows) => Page.Message.UpdatedMessages({ messages: rows })),
	)
	const reactions = subscribe(
		Data.reactionsStream(channelId, (rows) => Page.Message.UpdatedReactions({ reactions: rows })),
	)
	const page = Page.update(
		Page.update(Page.init(channelId, currentUserId), await messages.next()).model,
		await reactions.next(),
	).model
	return { messages, reactions, page, collections: [messageCollection, messageReactionCollection] }
}
