/**
 * From messages to list entries: grouping (same author within five minutes), date dividers, the unread
 * divider, and each message's compact row (option C's wire shape). Rows are cached by message object,
 * so an unchanged message keeps its row's identity and Effect UI never re-sends its props.
 */
import { type Message, me, type Person, people } from "./fixture.ts"
import { type Block, parse } from "./rich-text.ts"

/**
 * One message row as it crosses in option C: the vocabulary's `MessageRow` keys (readable, per the
 * phase 1.5 decision); grouping is the message's own `grouped` flag, not row data.
 */
export interface Row {
	/** Author name, initials; absent on a grouped row. */
	readonly author?: string
	readonly initials?: string
	/** Time, `HH:MM`. */
	readonly time: string
	readonly body: ReadonlyArray<Block>
	readonly reactions?: ReadonlyArray<{ readonly emoji: string; readonly count: number; readonly mine: boolean }>
	/** Image attachments by pixel size. */
	readonly files?: ReadonlyArray<{
		readonly id: string
		readonly kind: "image"
		readonly name: string
		readonly width: number
		readonly height: number
	}>
}

export type Entry =
	| { readonly kind: "date"; readonly key: string; readonly label: string }
	| { readonly kind: "unread"; readonly key: string }
	| {
			readonly kind: "message"
			readonly key: string
			readonly message: Message
			readonly grouped: boolean
			readonly row: Row
	  }

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
	const reactions = message.reactions.map((r) => ({
		emoji: r.emoji,
		count: r.users.length,
		mine: r.users.includes(me.id),
	}))
	const files = message.attachments.map((a, index) => ({
		id: `${message.id}-${index}`,
		kind: "image" as const,
		name: "image",
		width: a.width,
		height: a.height,
	}))
	const base = { time: time(message.createdAt), body: parse(message.content, names) }
	const withAuthor: Row = grouped ? base : { ...base, author, initials: initials(author) }
	const withReactions: Row = reactions.length > 0 ? { ...withAuthor, reactions } : withAuthor
	const row: Row = files.length > 0 ? { ...withReactions, files } : withReactions
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
		out.push({ kind: "message", key: message.id, message, grouped, row: rowOf(message, grouped) })
		previous = message
	}
	return out
}
