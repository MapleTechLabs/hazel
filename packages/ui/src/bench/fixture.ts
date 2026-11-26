/**
 * G7's big channel: the kinds of `apps/ios-hybrid/web/big-channel.ts` (one-liners, paragraphs, code,
 * lists, mentions, reactions) plus links, inline code and image attachments. Deterministic, no domain
 * imports, so it bundles small into JavaScriptCore.
 */

const MINUTE = 60_000
/** Fixed so every run lays out the same rows (dates, dividers, grouping). */
export const BASE_TIME = Date.UTC(2026, 10, 26, 17, 0, 0)

export interface Person {
	readonly id: string
	readonly name: string
}

export const people: ReadonlyArray<Person> = [
	{ id: "u1", name: "Ada Lovelace" },
	{ id: "u2", name: "Grace Hopper" },
	{ id: "u3", name: "Linus Torvalds" },
	{ id: "u4", name: "Margaret Hamilton" },
	{ id: "u5", name: "Ken Thompson" },
	{ id: "u6", name: "Barbara Liskov" },
	{ id: "u7", name: "Dennis Ritchie" },
]
export const me = people[0]!

export interface Reaction {
	readonly emoji: string
	readonly users: ReadonlyArray<string>
}

export interface Attachment {
	readonly id: string
	readonly name: string
	readonly width: number
	readonly height: number
}

export interface Message {
	readonly id: string
	readonly authorId: string
	readonly content: string
	readonly createdAt: number
	readonly reactions: ReadonlyArray<Reaction>
	readonly attachments: ReadonlyArray<Attachment>
}

const SHORT = [
	"Shipping it.",
	"LGTM 👍",
	"On it.",
	"Can someone take a look at the flaky test?",
	"Deploy is green.",
	"Back in 10.",
	"Nice catch!",
	"Merged.",
]
const LONG = [
	"I went through the sync logs from last night and the reconnects line up with the deploys: every socket drops when the Durable Object restarts, and the client waits the full backoff before it tries again. We could resume from the last seq instead of refetching the window, which would also make the reconnect invisible to the reader.",
	"Quick summary of the perf work: the list now measures rows once and keeps the heights by message id, so scrolling back up never re-lays out what it already saw. The remaining cost is avatars decoding on the main thread; moving that off should get us to a steady frame budget.",
	"For the release notes: the composer keeps drafts per channel, pasted images upload in the background, and mentions autocomplete members across sections. Let me know if I missed anything you shipped this week.",
]
const CODE = [
	"Here's the fix:\n\n```ts\nconst window = rows.slice(start, end)\nfor (const row of window) measure(row)\n```",
	"Repro:\n\n```sh\nbun run test:once --filter sync\n```\n\nFails about one run in five.",
]
const LISTS = [
	"Plan for tomorrow:\n- finish the migration\n- review the composer PR\n- write up the incident",
	"Blockers:\n1. CI cache misses\n2. the staging DO is out of date",
]
const LINKS = [
	"The design notes are at https://hazel.sh/docs/sync and the trace is in Maple.",
	"Call `applyMigrations` before `makeObjectRuntime` returns, see https://github.com/hazel/hazel/pull/4210 for why.",
	"**Heads up:** the `channel_index` rebuild runs tonight.",
]
const EMOJI = ["👍", "🎉", "❤️", "🚀", "👀", "🙏"]

const pad = (n: number) => n.toString().padStart(6, "0")

/** Message `index` of the channel (0 is the oldest). Pure, so pages and the new-message path agree. */
export const message = (index: number, count: number): Message => {
	const kind = index % 11
	const other = people[(index * 3 + 1) % people.length]!
	const content =
		kind === 3
			? LONG[index % LONG.length]!
			: kind === 6
				? CODE[index % CODE.length]!
				: kind === 8
					? LISTS[index % LISTS.length]!
					: kind === 9
						? `@[userId:${other.id}] ${SHORT[index % SHORT.length]}`
						: kind === 5
							? LINKS[index % LINKS.length]!
							: `${SHORT[index % SHORT.length]} (${index})`
	const reactions: Array<Reaction> = []
	if (index % 4 === 0) {
		for (let r = 0; r < 1 + (index % 3); r++) {
			reactions.push({
				emoji: EMOJI[(index + r) % EMOJI.length]!,
				users: [people[(index + r) % people.length]!.id],
			})
		}
	}
	const attachments: Array<Attachment> =
		index % 13 === 7 ? [{ id: `a${pad(index)}`, name: `screenshot-${index}.png`, width: 1170, height: 780 }] : []
	// Runs of five from one author a few minutes apart, so grouping has something to group.
	const shift = index % 5 === 0 ? 0 : 2 * MINUTE
	return {
		id: `m${pad(index)}`,
		authorId: people[(Math.floor(index / 5) * 3) % people.length]!.id,
		content,
		createdAt: BASE_TIME - (count - index) * 4 * MINUTE - shift,
		reactions,
		attachments,
	}
}

/** Messages `[from, to)` of a `count`-message channel, oldest first. */
export const messages = (from: number, to: number, count: number): ReadonlyArray<Message> => {
	const out: Array<Message> = []
	for (let i = from; i < to; i++) out.push(message(i, count))
	return out
}
