import { heavyDataset } from "../../../../packages/ui-parity/src/fixtures/datasets/heavy.ts"
import {
	applyChanges,
	channelWindow,
	emptyStore,
	type ShapeChange,
	type Store,
	StoreMessage,
	windowReactions,
} from "../../src/data/normalized-store.ts"
import * as Page from "../../src/page/chat/page.ts"
import {
	channelId,
	currentUserId,
	deepFreeze,
	freshId,
	median,
	newMessageRow,
	round,
	time,
} from "./shared.ts"

/**
 * Option (b): shape change rows arrive in a validated Message, a reducer folds them into the
 * normalized store, and the page re-derives its window from the store (no array-carrying Message).
 */

const tables = heavyDataset.tables
const asChanges = (table: ShapeChange["table"], rows: ReadonlyArray<Record<string, unknown>> | undefined) =>
	(rows ?? []).map((row) => ({ table, operation: "insert", row }) as unknown as ShapeChange)

/** The page derives from the store inside update, so its Message is a plain literal here. */
const derivePage = (page: Page.Model, store: Store, limit: number) => {
	const window = channelWindow(store, channelId, limit)
	const withMessages = Page.update(page, { _tag: "UpdatedMessages", messages: window }).model
	return Page.update(withMessages, { _tag: "UpdatedReactions", reactions: windowReactions(store, window) })
		.model
}

export const runB = async (limit: number, samples: number) => {
	const initialChanges = [
		...asChanges("users", tables.users),
		...asChanges("messages", tables.messages),
		...asChanges("message_reactions", tables.message_reactions),
	]
	const [, initialConstructMs] = time(() => StoreMessage.ReceivedShapeChanges({ changes: initialChanges }))
	let [store, initialApplyMs] = time(() => applyChanges(emptyStore, initialChanges))
	let [page, initialDeriveMs] = time(() => derivePage(Page.init(channelId, currentUserId), store, limit))
	const [, initialFreezeMs] = time(() => {
		deepFreeze(store)
		deepFreeze(page)
	})

	const message = {
		construct: [] as number[],
		apply: [] as number[],
		derive: [] as number[],
		freeze: [] as number[],
	}
	for (let index = 0; index < samples; index++) {
		const changes = asChanges("messages", [newMessageRow(index)])
		message.construct.push(time(() => StoreMessage.ReceivedShapeChanges({ changes }))[1])
		const [nextStore, applyMs] = time(() => applyChanges(store, changes))
		const [nextPage, deriveMs] = time(() => derivePage(page, nextStore, limit))
		message.apply.push(applyMs)
		message.derive.push(deriveMs)
		message.freeze.push(
			time(() => {
				deepFreeze(nextStore)
				deepFreeze(nextPage)
			})[1],
		)
		store = nextStore
		page = nextPage
	}

	const reaction = { apply: [] as number[], derive: [] as number[], freeze: [] as number[] }
	const target = page.messages[0]!
	for (let index = 0; index < samples; index++) {
		const row = { id: freshId(), messageId: target.id, userId: currentUserId, emoji: "🚀" }
		for (const operation of ["insert", "delete"] as const) {
			const changes: ReadonlyArray<ShapeChange> = [{ table: "message_reactions", operation, row }]
			const [nextStore, applyMs] = time(() => applyChanges(store, changes))
			const [nextPage, deriveMs] = time(() => derivePage(page, nextStore, limit))
			reaction.apply.push(applyMs)
			reaction.derive.push(deriveMs)
			reaction.freeze.push(
				time(() => {
					deepFreeze(nextStore)
					deepFreeze(nextPage)
				})[1],
			)
			store = nextStore
			page = nextPage
		}
	}

	return {
		initialMs: round(initialConstructMs + initialApplyMs + initialDeriveMs),
		"initial construct/apply/derive/freeze": [
			initialConstructMs,
			initialApplyMs,
			initialDeriveMs,
			initialFreezeMs,
		]
			.map(round)
			.join(" / "),
		newMessageMs: round(median(message.construct) + median(message.apply) + median(message.derive)),
		"msg construct/apply/derive/freeze": [
			message.construct,
			message.apply,
			message.derive,
			message.freeze,
		]
			.map(median)
			.join(" / "),
		reactionToggleMs: round(median(reaction.apply) + median(reaction.derive)),
		"reaction apply/derive/freeze": [reaction.apply, reaction.derive, reaction.freeze]
			.map(median)
			.join(" / "),
	}
}

/** Everything option (b) keeps alive: the normalized store of all synced rows and the page. */
export const setupForHeap = async (limit: number) => {
	const changes = [
		...asChanges("users", tables.users),
		...asChanges("messages", tables.messages),
		...asChanges("message_reactions", tables.message_reactions),
	]
	const store = deepFreeze(applyChanges(emptyStore, changes))
	return { store, page: deepFreeze(derivePage(Page.init(channelId, currentUserId), store, limit)) }
}
