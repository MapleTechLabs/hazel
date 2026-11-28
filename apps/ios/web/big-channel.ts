/**
 * A big channel for the performance bar (120 fps scrolling, no dropped frames): #engineering gets
 * `count` messages of the kinds a busy channel has (one-liners, paragraphs, code, mentions, lists,
 * reactions), deterministic so every run scrolls the same content.
 */
import { channelIds, userRows } from "../fixture/snapshot"

const MINUTE = 60_000

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
const EMOJI = ["👍", "🎉", "❤️", "🚀", "👀", "🙏"]

const hex = (n: number, width: number) => n.toString(16).padStart(width, "0")
const uuid = (group: number, index: number) => `${hex(group, 8)}-0000-4000-8000-${hex(index, 12)}`

/** `count` messages (and their reactions) for #engineering, ending now. */
export const bigChannel = (count: number) => {
	const channelId = channelIds[1] ?? ""
	const people = userRows.map((user) => user.id)
	const at = (index: number) => new Date(Date.now() - (count - index) * 7 * MINUTE).toISOString()
	const messages = []
	const reactions = []
	for (let index = 0; index < count; index++) {
		const kind = index % 11
		const author = people[(index * 7) % people.length] ?? ""
		const other = people[(index * 3 + 1) % people.length] ?? ""
		const content =
			kind === 3
				? (LONG[index % LONG.length] ?? "")
				: kind === 6
					? (CODE[index % CODE.length] ?? "")
					: kind === 8
						? (LISTS[index % LISTS.length] ?? "")
						: kind === 9
							? `@[userId:${other}] ${SHORT[index % SHORT.length]}`
							: `${SHORT[index % SHORT.length]} (${index})`
		const id = uuid(0x99, index + 1)
		messages.push({
			id,
			channelId,
			conversationId: null,
			authorId: author,
			content,
			embeds: null,
			replyToMessageId: null,
			threadChannelId: null,
			createdAt: at(index),
			updatedAt: null,
			deletedAt: null,
		})
		if (index % 4 === 0) {
			for (let r = 0; r < 1 + (index % 3); r++) {
				reactions.push({
					id: uuid(0x98, reactions.length + 1),
					messageId: id,
					channelId,
					conversationId: null,
					userId: people[(index + r) % people.length] ?? "",
					emoji: EMOJI[(index + r) % EMOJI.length] ?? "👍",
					createdAt: at(index),
				})
			}
		}
	}
	return { channelId, messages, reactions }
}
