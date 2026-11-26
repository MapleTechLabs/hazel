/**
 * What a DMs row says, as today's phone DMs tab says it (`web-foldkit/src/page/chat-index/mobile-dms.ts`):
 * the name, the last message with its author, a short time. Pure, so both hosts and tests share it.
 */
import type { UserId } from "@hazel/schema"

export interface Person {
	readonly userId: UserId
	readonly firstName: string
	readonly lastName: string
	readonly avatarUrl: string | null
}

export interface DmSummary {
	readonly type: "direct" | "single"
	readonly name: string
	readonly lastMessageAtMs: number | null
	readonly lastMessageAuthorId: UserId | null
	readonly lastMessagePreview: string | null
}

export const fullName = (person: Person) => `${person.firstName} ${person.lastName}`.trim()

export const initialsOf = (name: string) =>
	name
		.split(/\s+/)
		.map((part) => part[0] ?? "")
		.join("")
		.slice(0, 2)
		.toUpperCase()

/** The other member of a one-to-one DM, or none for a group DM. */
export const partnerOf = (dm: DmSummary, others: ReadonlyArray<Person>): Person | undefined =>
	dm.type === "single" && others.length === 1 ? others[0] : undefined

/** A one-to-one DM is titled by its partner; a group DM by the others' first names. */
export const titleOf = (dm: DmSummary, others: ReadonlyArray<Person>): string => {
	const partner = partnerOf(dm, others)
	if (partner !== undefined) return fullName(partner)
	return others.map((person) => person.firstName).join(", ") || dm.name
}

/** The second line: `You: …`, a group DM's `Ada: …`, or who the DM is with before any message. */
export const previewOf = (
	dm: DmSummary,
	members: ReadonlyArray<Person>,
	others: ReadonlyArray<Person>,
	currentUserId: UserId,
): string => {
	if (dm.lastMessageAtMs === null)
		return partnerOf(dm, others) === undefined ? `${others.length + 1} people` : "Say hello 👋"
	const text = dm.lastMessagePreview ?? "Sent an attachment"
	if (dm.lastMessageAuthorId === currentUserId) return `You: ${text}`
	if (dm.type === "single") return text
	const author = members.find((person) => person.userId === dm.lastMessageAuthorId)
	return author === undefined ? text : `${author.firstName}: ${text}`
}

const DAY_MS = 86_400_000
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const startOfDay = (ms: number) => {
	const date = new Date(ms)
	date.setHours(0, 0, 0, 0)
	return date.getTime()
}

/** A row's time, short as Slack's: `now`, `12m`, `3h`, `Yesterday`, `Mon`, `Mar 3`, `Mar 3, 2025`. */
export const dmTimeOf = (atMs: number, nowMs: number): string => {
	const minutes = Math.floor((nowMs - atMs) / 60_000)
	if (minutes < 1) return "now"
	if (minutes < 60) return `${minutes}m`
	const today = startOfDay(nowMs)
	if (atMs >= today) return `${Math.floor(minutes / 60)}h`
	if (atMs >= today - DAY_MS) return "Yesterday"
	const date = new Date(atMs)
	if (atMs >= today - 6 * DAY_MS) return WEEKDAYS[date.getDay()] ?? ""
	const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`
	return date.getFullYear() === new Date(nowMs).getFullYear() ? day : `${day}, ${date.getFullYear()}`
}
