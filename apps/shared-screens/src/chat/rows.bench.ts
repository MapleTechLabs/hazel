// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The message list's work per unrelated change: `derive` time, rows whose entry changed identity,
 * row props the renderer passes on (it skips a `===` prop) and `message` primitive redraws, at
 * 50/200/500/1000 messages. `bun run bench` in `apps/shared-screens`.
 */
import { ChannelId, MessageId, UserId } from "@hazel/schema"
// The bench measures the host primitive's redraws; it never ships in the screen.
// oxlint-disable-next-line hazel/no-raw-escape
import { primitive as messagePrimitive } from "@hazel/ui/web/primitives/chat/message"
import type { Content } from "@hazel/ui/vocabulary/index"
import { Window } from "happy-dom"
import { derive, type MessageListModel } from "./MessageList"
import { initialLiveState } from "./rich/live-replies"
import { richPartsOf } from "./rich/embeds"
import { type ChatMessage, type Entry, type RowEntry, rowWithCards } from "./rows"

const NOW = Date.parse("2026-11-26T12:00:00.000Z")
const MINUTE = 60_000
const channelId = ChannelId.make("00000005-0000-4000-8000-000000000001")
const userId = (n: number) => UserId.make(`00000001-0000-4000-8000-${n.toString(16).padStart(12, "0")}`)
const messageId = (n: number) => MessageId.make(`00000009-0000-4000-8000-${n.toString(16).padStart(12, "0")}`)
const threadId = (n: number) => ChannelId.make(`00000007-0000-4000-8000-${n.toString(16).padStart(12, "0")}`)
const AUTHORS = 8
const me = userId(0)

const contentOf = (n: number) => {
	const kind = n % 10
	if (kind === 0) return `Here is the doc https://example.com/docs/${n}`
	if (kind === 1)
		return `**Heads up** @[userId:${userId((n + 1) % AUTHORS)}] the \`build\` failed on _main_`
	if (kind === 2) return `Steps:\n- pull\n- run \`bun install\`\n- restart\n\n> quoted from before ${n}`
	if (kind === 3) return "```ts\nconst x = 1\nconsole.log(x)\n```\nthat is the snippet"
	return `Plain message number ${n} with some words to read, about the release and the next steps.`
}

const messagesOf = (count: number): ReadonlyArray<ChatMessage> =>
	Array.from({ length: count }, (_, index) => {
		const n = count - index
		const content = contentOf(n)
		const live = n % 97 === 0
		return {
			id: messageId(n),
			channelId,
			authorId: userId(Math.floor(n / 3) % AUTHORS),
			content,
			createdAtMs: NOW - index * 2 * MINUTE,
			updatedAtMs: null,
			replyToMessageId: n % 20 === 5 && n > 1 ? messageId(n - 1) : null,
			threadChannelId: n % 10 === 7 ? threadId(n) : null,
			isPinned: n % 50 === 0,
			pinnedId: n % 50 === 0 ? `pin-${n}` : null,
			rich: richPartsOf(
				messageId(n),
				content,
				live ? [{ liveState: { enabled: true, loading: { text: "Thinking" } } }] : null,
			),
		}
	})

const usersOf = (version: number) =>
	Array.from({ length: AUTHORS + 40 }, (_, n) => ({
		id: userId(n),
		firstName: `First${n}`,
		lastName: n === AUTHORS + 39 ? `Last${version}` : `Last${n}`,
		avatarUrl: n % 2 === 0 ? `https://cdn.example.com/${n}.png` : null,
		userType: "user",
		email: null,
	}))

const reactionsOf = (messages: ReadonlyArray<ChatMessage>, extra: boolean) => [
	...messages.flatMap((message, index) =>
		index % 3 === 0
			? [
					{ messageId: message.id, userId: userId(1), emoji: "👍" },
					{ messageId: message.id, userId: userId(2), emoji: "👍" },
					{ messageId: message.id, userId: userId(3), emoji: "🎉" },
				]
			: [],
	),
	...(extra && messages[0] !== undefined ? [{ messageId: messages[0].id, userId: me, emoji: "😂" }] : []),
]

const modelOf = (count: number): MessageListModel => {
	const messages = messagesOf(count)
	const threads = messages.flatMap((message) =>
		message.threadChannelId === null ? [] : [message.threadChannelId],
	)
	return derive(
		{
			awaiting: [],
			messages,
			limit: count,
			hasMore: true,
			loadingOlder: false,
			reactions: reactionsOf(messages, false),
			users: usersOf(0),
			bots: [],
			attachments: messages.flatMap((message, index) =>
				index % 20 === 0
					? [
							{
								id: `att-${index}`,
								messageId: message.id,
								fileName: "shot.png",
								fileSize: 20480,
								url: "u",
							},
						]
					: [],
			),
			threadNames: threads.map((id) => ({ id, name: `Thread ${id.slice(-4)}` })),
			threadMessages: threads.flatMap((id) =>
				[0, 1, 2].map((k) => ({
					channelId: id,
					authorId: userId(k),
					content: `reply ${k}`,
					createdAtMs: NOW - k * MINUTE,
				})),
			),
			replyTargets: messages.flatMap((message) =>
				message.replyToMessageId === null
					? []
					: [{ id: message.replyToMessageId, authorId: userId(1), content: "earlier" }],
			),
			sinceMs: null,
			sinceCaptured: true,
			jumpPending: false,
			entries: [],
			nowMs: NOW,
			picker: null,
			profile: null,
			profilePresence: null,
			menu: null,
			live: {},
			fullscreen: null,
		},
		me,
	)
}

/** The view's preview cards: half the links answered, the rest still loading (a fresh object each time). */
const cardsOf = (entry: RowEntry): ReadonlyArray<Content.Embed> =>
	entry.previews.map((request, index) =>
		index % 2 === 0
			? { url: request.url, title: "Example", description: "A page", site: "example.com" }
			: {
					url: request.url,
					title: "example.com",
					description: "Loading preview…",
					site: "example.com",
				},
	)

/** Unrelated changes, each a step from the previous model (the stream hands fresh objects every time). */
const SCENARIOS: ReadonlyArray<readonly [string, (model: MessageListModel, i: number) => MessageListModel]> =
	[
		[
			"reaction on one message",
			(model, i) => ({ ...model, reactions: reactionsOf(model.messages ?? [], i % 2 === 0) }),
		],
		["users update", (model, i) => ({ ...model, users: usersOf(i) })],
		["clock tick", (model, i) => ({ ...model, nowMs: NOW + (i + 1) * MINUTE })],
		[
			"live reply chunk",
			(model, i) => {
				const live = (model.messages ?? []).find((message) => message.rich.live !== null)
				if (live === undefined) return model
				const state = model.live[live.id] ?? {
					...initialLiveState,
					status: "active" as const,
					isStreaming: true,
				}
				return {
					...model,
					live: { ...model.live, [live.id]: { ...state, text: `${state.text} chunk${i}` } },
				}
			},
		],
	]

const rowsOf = (entries: ReadonlyArray<Entry>) =>
	entries.filter((entry): entry is RowEntry => entry._tag === "Row")

const quantile = (sorted: ReadonlyArray<number>, q: number) =>
	sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0

const window = new Window()
// SAFETY: happy-dom's Document implements the DOM Document the primitive draws into.
const document = window.document as unknown as Document
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** One mounted `message` primitive per row, fed only the props that changed by reference. */
const mount = async (entries: ReadonlyArray<RowEntry>) => {
	interface Mounted {
		readonly primitive: ReturnType<typeof messagePrimitive.create>
		row: Content.MessageRow
		last: Node | null
	}
	const rows = new Map(
		entries.map((entry): readonly [string, Mounted] => {
			const outer = (tagName: string) => document.createElement(tagName)
			const self = () => {
				throw new Error("unused")
			}
			const primitive = messagePrimitive.create({ document, tag: "hz:message", outer, self })
			const row = rowWithCards(entry, cardsOf(entry))
			primitive.set("row", row)
			return [entry.key, { primitive, row, last: null }]
		}),
	)
	await flush()
	for (const mounted of rows.values()) mounted.last = mounted.primitive.outer.lastChild
	return {
		/** Props passed on, then redraws (a row whose DOM was rebuilt). */
		render: async (next: ReadonlyArray<RowEntry>) => {
			let props = 0
			for (const entry of next) {
				const mounted = rows.get(entry.key)
				if (mounted === undefined) continue
				const row = rowWithCards(entry, cardsOf(entry))
				if (row !== mounted.row) {
					props++
					mounted.row = row
					mounted.primitive.set("row", row)
				}
			}
			await flush()
			let draws = 0
			for (const mounted of rows.values()) {
				const last = mounted.primitive.outer.lastChild
				if (last !== mounted.last) draws++
				mounted.last = last
			}
			return { props, draws }
		},
	}
}

const ITERATIONS = 200
const DOM_ITERATIONS = 10

const run = async () => {
	console.log(`${navigator.userAgent}, ${process.platform} ${process.arch}`)
	console.log(
		"| messages | change | derive median ms | derive p95 ms | rows re-identified | row props set | draws |",
	)
	console.log("|---:|---|---:|---:|---:|---:|---:|")
	for (const count of [50, 200, 500, 1000]) {
		for (const [name, step] of SCENARIOS) {
			let model = modelOf(count)
			for (let i = 0; i < 20; i++) model = derive(step(model, i), me)
			const times: Array<number> = []
			let changed = 0
			for (let i = 0; i < ITERATIONS; i++) {
				const input = step(model, i + 20)
				const start = performance.now()
				const next = derive(input, me)
				times.push(performance.now() - start)
				const before = new Set(model.entries)
				changed += next.entries.filter((entry) => !before.has(entry)).length
				model = next
			}
			times.sort((a, b) => a - b)
			const dom = await mount(rowsOf(model.entries))
			let props = 0
			let draws = 0
			for (let i = 0; i < DOM_ITERATIONS; i++) {
				model = derive(step(model, i + 20 + ITERATIONS), me)
				const counted = await dom.render(rowsOf(model.entries))
				props += counted.props
				draws += counted.draws
			}
			console.log(
				`| ${count} | ${name} | ${quantile(times, 0.5).toFixed(3)} | ${quantile(times, 0.95).toFixed(3)} | ${(changed / ITERATIONS).toFixed(1)} | ${(props / DOM_ITERATIONS).toFixed(1)} | ${(draws / DOM_ITERATIONS).toFixed(1)} |`,
			)
		}
	}
	await window.happyDOM.close()
}

await run()
