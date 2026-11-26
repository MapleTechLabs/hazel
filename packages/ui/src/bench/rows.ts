/**
 * From messages to list entries: grouping (same author within five minutes), date dividers, the unread
 * divider, and each message's compact row (option C's wire shape). Rows are cached by message object,
 * so an unchanged message keeps its row's identity and Effect UI never re-sends its props.
 */
import { type Message, me, type Person, people } from "./fixture.ts"
import { type Block, parse } from "./rich-text.ts"

/** One message row as it crosses in option C. Short keys: this is per row, 3,000 times. */
export interface Row {
	/** Author name, initials; absent on a grouped row. */
	readonly a?: string
	readonly i?: string
	/** Time, `HH:MM`. */
	readonly t: string
	/** Grouped under the previous message. */
	readonly g?: 1
	readonly b: ReadonlyArray<Block>
	/** Reactions: `[emoji, count, mine]`. */
	readonly r?: ReadonlyArray<readonly [string, number, 0 | 1]>
	/** Image attachments: `[width, height]`. */
	readonly m?: ReadonlyArray<readonly [number, number]>
}

export type Entry =
	| { readonly kind: "date"; readonly key: string; readonly label: string }
	| { readonly kind: "unread"; readonly key: string }
	| { readonly kind: "message"; readonly key: string; readonly message: Message; readonly row: Row }

export const names: ReadonlyMap<string, Person> = new Map(people.map((p) => [p.id, p]))

const GROUP_MS = 5 * 60_000
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const two = (n: number) => (n < 10 ? `0${n}` : `${n}`)
const time = (at: number) => {
	const d = new Date(at)
	return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`
}
const day = (at: number) => Math.floor(at / 86_400_000)
const dayLabel = (at: number) => {
	const d = new Date(at)
	return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
const initials = (name: string) =>
	name
		.split(" ")
		.map((part) => part[0] ?? "")
		.join("")
		.slice(0, 2)

const cache = new WeakMap<Message, { readonly grouped: boolean; readonly row: Row }>()

export const rowOf = (message: Message, grouped: boolean): Row => {
	const hit = cache.get(message)
	if (hit !== undefined && hit.grouped === grouped) return hit.row
	const author = names.get(message.authorId)?.name ?? "Unknown"
	const reactions = message.reactions.map(
		(r) => [r.emoji, r.users.length, r.users.includes(me.id) ? 1 : 0] as const,
	)
	const row: Row = {
		...(grouped ? { g: 1 as const } : { a: author, i: initials(author) }),
		t: time(message.createdAt),
		b: parse(message.content, names),
		...(reactions.length > 0 ? { r: reactions } : {}),
		...(message.attachments.length > 0
			? { m: message.attachments.map((a) => [a.width, a.height] as const) }
			: {}),
	}
	cache.set(message, { grouped, row })
	return row
}

/** Entries oldest first. `unreadAfter` is the id of the last read message. */
export const entries = (messages: ReadonlyArray<Message>, unreadAfter?: string): ReadonlyArray<Entry> => {
	const out: Array<Entry> = []
	let previous: Message | undefined
	for (const message of messages) {
		const newDay = previous === undefined || day(previous.createdAt) !== day(message.createdAt)
		if (newDay) out.push({ kind: "date", key: `d${day(message.createdAt)}`, label: dayLabel(message.createdAt) })
		const unread = previous !== undefined && previous.id === unreadAfter
		if (unread) out.push({ kind: "unread", key: "unread" })
		const grouped =
			!newDay &&
			!unread &&
			previous !== undefined &&
			previous.authorId === message.authorId &&
			message.createdAt - previous.createdAt < GROUP_MS
		out.push({ kind: "message", key: message.id, message, row: rowOf(message, grouped) })
		previous = message
	}
	return out
}
