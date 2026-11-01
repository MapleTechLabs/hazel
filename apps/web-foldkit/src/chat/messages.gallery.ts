import "@fontsource/inter/400.css"
import "@fontsource/inter/400-italic.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "@fontsource/inter/700.css"
import "../styles.css"
import type { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Context } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { MountTracker } from "foldkit/mount"
import { __clearRuntime, __htmlBuilder, __setRuntime } from "foldkit-internal/html/index.js"
import { Dispatch } from "foldkit-internal/runtime/dispatch.js"
import { patch } from "foldkit-internal/vdom.js"
import { afterEach, test } from "vitest"
import { commands, page } from "vitest/browser"
import type { EmbedType } from "./embeds"
import type { MessageRow } from "../page/chat/rows"
import { imageViewerView } from "./image-viewer"
import { avatarButton, messageRowView, type RowContext } from "./message/row"

/**
 * The message lab: real message rows (markdown, bot embeds, chart images) in light and dark, built
 * from `messageRowView` and the app stylesheet. Not a test: `bun run gallery` writes
 * `messages-light.png`, `messages-dark.png` and a self-contained `messages-lab.html`.
 */

type M = never

const render = (view: (h: HtmlBuilder<M>) => Html) => {
	const dispatch = Dispatch.of({ dispatchAsync: () => undefined as never, dispatchSync: () => undefined })
	__setRuntime(
		dispatch.dispatchSync,
		Context.make(Dispatch, dispatch).pipe(
			Context.add(MountTracker, { started: () => {}, ended: () => {} }),
		),
	)
	try {
		const vnode = view(__htmlBuilder<M>())
		const container = document.createElement("div")
		document.body.append(container)
		if (vnode) patch(container, vnode)
	} finally {
		__clearRuntime()
	}
}

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

const never = () => undefined as never

const context = (h: HtmlBuilder<M>): RowContext<M> => ({
	tooltip: { active: null, hoveredKey: null, toMessage: never, userName: () => null, currentUserId: null },
	toOpenImage: never,
	toOpenEmbedImage: never,
	toOpenThread: never,
	toReact: never,
	contextMenu: (_row, render) => render([], h.empty),
	avatar: (row) => avatarButton(h, row, []),
	mention: () => (_mention, toTrigger) => toTrigger([]),
	toHtmlRenderMessage: never,
	toPressEmbedAction: never,
})

/** The rows' ids and minutes, in the order they are built. */
const nextSequence = (() => {
	let sequence = 0
	return () => ++sequence
})()
const BASE_TIME = Date.UTC(2026, 10, 1, 11, 14)

const row = (options: {
	readonly name: string
	readonly isBot?: boolean
	readonly content: string
	readonly embeds?: ReadonlyArray<EmbedType>
	readonly urlEmbeds?: MessageRow["urlEmbeds"]
	readonly attachments?: MessageRow["attachments"]
}): MessageRow => {
	const sequence = nextSequence()
	const id = `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}` as MessageId
	const [firstName = "", lastName = ""] = options.name.split(" ")
	// A plain row: the lab's pictures and attachments are fixtures the row schema would reject.
	// oxlint-disable-next-line foldkit/prefer-callable-message-constructor
	return {
		_tag: "MessageRow",
		key: id,
		message: {
			id,
			channelId: "00000000-0000-4000-8000-0000000000aa" as ChannelId,
			authorId: "00000000-0000-4000-8000-0000000000bb" as UserId,
			content: options.content,
			embeds: options.embeds ?? null,
			hasEmbeds: (options.embeds?.length ?? 0) > 0,
			replyToMessageId: null,
			threadChannelId: null,
			createdAtMs: BASE_TIME + sequence * 60_000,
			updatedAtMs: null,
			isPinned: false,
			author: { firstName, lastName, avatarUrl: null, userType: options.isBot ? "machine" : "user" },
		},
		groupPosition: "standalone",
		reactions: [],
		author: { displayName: options.name, avatarUrl: null, isBot: options.isBot ?? false },
		status: null,
		isDiscordSynced: false,
		reply: null,
		thread: null,
		attachments: options.attachments ?? [],
		refs: { mentions: [{ userId: "u-ada", name: "Ada Lovelace" }], emojis: [] },
		urlEmbeds: options.urlEmbeds ?? [],
		live: null,
		htmlRenders: [],
	} as unknown as MessageRow
}

/** A bar chart like Maple's rendered PNG: dark, monospace labels, one bar per service. */
const barChart = (options: {
	readonly title: string
	readonly rows: ReadonlyArray<readonly [string, number]>
	readonly width: number
	readonly rowHeight: number
}) => {
	const { width, rowHeight } = options
	const max = Math.max(...options.rows.map(([, value]) => value))
	const labelWidth = 190
	const barWidth = width - labelWidth - 90
	const top = 56
	const height = top + options.rows.length * rowHeight + 24
	const bars = options.rows
		.map(([label, value], index) => {
			const y = top + index * rowHeight
			const w = Math.max(2, (value / max) * barWidth)
			return [
				`<text x="16" y="${y + rowHeight / 2 + 4}" fill="#c9c4bd" font-size="13">${label}</text>`,
				`<rect x="${labelWidth}" y="${y + rowHeight / 2 - 6}" width="${w}" height="12" rx="2" fill="#ef3b4a"/>`,
				`<text x="${labelWidth + w + 8}" y="${y + rowHeight / 2 + 4}" fill="#8a847c" font-size="12">${value}%</text>`,
			].join("")
		})
		.join("")
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, Menlo, monospace"><rect width="100%" height="100%" fill="#1b1814"/><text x="16" y="34" fill="#ece7e1" font-size="17" font-weight="700">${options.title}</text>${bars}</svg>`
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const SERVICES: ReadonlyArray<readonly [string, number]> = [
	["electric-sync", 61.8],
	["github-actions", 11.2],
	["maple-cli", 5.5],
	["chat-agent-streaming", 2.2],
	["api-gateway", 0.01],
	["ingest", 0],
	["query-engine", 0],
	["alerting", 0],
	["web", 0],
	["scheduler", 0],
	["hazel-sync", 0],
	["backend-worker", 0],
	["realtime", 0],
	["uptime", 0],
	["billing", 0],
	["mcp", 0],
	["landing", 0],
]

const tallChart = barChart({
	title: "service error rate (last 6h)",
	rows: SERVICES,
	width: 760,
	rowHeight: 30,
})
const wideChart = barChart({
	title: "p95 latency by route (ms)",
	rows: [
		["GET /api/traces", 412],
		["POST /v1/logs", 188],
		["GET /api/services", 96],
	],
	width: 1200,
	rowHeight: 34,
})

/** The message from the bug report, as Maple's connector writes it (blocks joined by blank lines). */
const mapleHealth = row({
	name: "Maple",
	isBot: true,
	content: [
		"Here's the current health snapshot across all 17 services over the last 6 hours — ranked by error rate:",
		"Three services stand out:\n- **electric-sync — 61.8%** errors, but at very low volume (1.45 req/min). Worth a look even if small.\n- **github-actions — 11.2% of runs failing, with a very long p95 (357s)**.\n- **maple-cli — 5.55%** errors on the busiest service (631 req/min), so this one affects the most traffic by far.",
		"The other 13 are essentially clean (≤2.2%). Want me to dig into `maple-cli` first, since it carries the most volume?",
	].join("\n\n"),
	embeds: [
		{
			title: "Service error rate (last 6h)",
			description: "17 items, highest electric-sync (61.8)",
			image: { url: tallChart },
		},
	],
})

const richMarkdown = row({
	name: "Maple",
	isBot: true,
	content: [
		"## Incident summary",
		"Root cause was a *connection pool* exhaustion in `query_engine_v2`; ~~retries~~ backoff made it worse. See [the trace](https://maple.dev/traces/abc) or https://maple.dev/services/query-engine for details.",
		"1. Pool size dropped to 4 after deploy `a1b2c3d`\n2. p95 rose from 120ms to 4.1s\n3. Alert fired at 11:02",
		"> Deploys between 10:50 and 11:00 touched `pool.ts` only.\n> Rolling back fixed it within 3 minutes.",
		"```sql\nSELECT service, count(*) AS errors\nFROM traces\nWHERE status = 'error' AND ts > now() - INTERVAL 6 HOUR\nGROUP BY service\nORDER BY errors DESC\n```",
		"| Service | Error rate | Req/min |\n| --- | ---: | ---: |\n| electric-sync | 61.8% | 1.45 |\n| github-actions | 11.2% | 0.3 |\n| maple-cli | 5.55% | 631 |",
		"-# Generated from 17 services over the last 6 hours",
	].join("\n\n"),
})

const alertCard = row({
	name: "Maple",
	isBot: true,
	content: "",
	embeds: [
		{
			title: "High error rate on maple-cli",
			url: "https://maple.dev/alerts/1",
			color: 0xef3b4a,
			description: "Error rate is **5.55%**, above the 5% threshold for 10 minutes.",
			fields: [
				{
					name: "Severity",
					value: "Critical",
					type: "badge",
					options: { intent: "danger" },
					inline: true,
				},
				{ name: "Signal", value: "Error rate", inline: true },
				{ name: "Observed", value: "5.55% (threshold > 5%)", inline: true },
				{
					name: "Links",
					value: "[Open in Maple](https://maple.dev/a/1) · [Traces](https://maple.dev/t)",
					inline: false,
				},
			],
			image: { url: wideChart },
			footer: { text: "maple-cli  ·  production" },
			timestamp: new Date(BASE_TIME).toISOString(),
		},
	],
})

const approvalCard = row({
	name: "Maple",
	isBot: true,
	content: "_Searching traces · Reading service map…_",
	embeds: [
		{
			title: "Approve create_alert_rule?",
			description: "Alert when **maple-cli** error rate stays above 5% for 10 minutes.",
			footer: { text: "This one has to be approved in Maple." },
		},
	],
})

const githubCard = row({
	name: "GitHub",
	isBot: true,
	content: "",
	embeds: [
		{
			author: { name: "MapleTechLabs/hazel" },
			badge: { text: "Merged", color: 0x8250df },
			title: "#381 fix(web): hover highlights end when the pointer leaves",
			url: "https://github.com/MapleTechLabs/hazel/pull/381",
			color: 0x8250df,
			description:
				"Rows kept their hover background after the pointer left through a popover. The list now clears it on `pointerleave`.",
			fields: [
				{ name: "Diff", value: "{green:+142} {red:-38} (180 lines)", inline: true },
				{ name: "Labels", value: "[[bug]] [[web]]", inline: true },
			],
			footer: { text: "GitHub" },
			timestamp: new Date(BASE_TIME).toISOString(),
		},
	],
})

/** A placeholder image of the given size, labelled with it. */
const picture = (width: number, height: number, hue: number) => {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 55%)"/><stop offset="1" stop-color="hsl(${hue + 50} 70% 35%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" fill="#fff" font-family="ui-monospace, monospace" font-size="${Math.max(10, Math.min(width, height) / 8)}" text-anchor="middle" dominant-baseline="middle">${width}×${height}</text></svg>`
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const imageCards = row({
	name: "Maple",
	isBot: true,
	content:
		"Image cases: a small image (never scaled up), a thumbnail, an image on its own, and a very wide one.",
	embeds: [
		{
			title: "Small image",
			description: "120×80, shown at its own size.",
			image: { url: picture(120, 80, 200) },
		},
		{
			title: "maple-cli",
			url: "https://maple.dev/services/maple-cli",
			color: 0x6938ef,
			description:
				"Service overview with a thumbnail in the corner. The thumbnail keeps its shape too.",
			thumbnail: { url: picture(160, 90, 270) },
			fields: [{ name: "Owner", value: "platform", inline: true }],
		},
		{ image: { url: picture(640, 960, 20) } },
		{ title: "Very wide", image: { url: picture(2400, 300, 140) } },
	],
})

const linkPreview = row({
	name: "Ada Lovelace",
	content: "https://maple.dev/blog/introducing-maple",
	urlEmbeds: [
		{
			_tag: "LinkPreview",
			url: "https://maple.dev/blog/introducing-maple",
			unfurl: {
				_tag: "Success",
				data: {
					_tag: "LinkPreview",
					preview: {
						url: "https://maple.dev/blog/introducing-maple",
						title: "Introducing Maple: observability that reads like a conversation",
						description:
							"Traces, logs and metrics on OpenTelemetry, with an agent that knows your services.",
						image: { url: picture(1200, 630, 300) },
					},
				},
			},
		},
	] as unknown as MessageRow["urlEmbeds"],
})

/** Pictures of mixed shapes (portrait, landscape, square, panorama), so the grid's cropping shows. */
const SHAPES: ReadonlyArray<readonly [number, number]> = [
	[1200, 800],
	[800, 1200],
	[1000, 1000],
	[1600, 600],
	[900, 1200],
	[1280, 720],
]
const pictures = (count: number, seed: number) =>
	Array.from({ length: count }, (_, index) => {
		const [width, height] = SHAPES[(index + seed) % SHAPES.length]!
		return picture(width, height, (seed * 47 + index * 37) % 360)
	})

const imageGrid = (count: number) =>
	row({
		name: "Maple",
		isBot: true,
		content: `**${count} image embeds** in one message.`,
		embeds: pictures(count, count).map((url, index) => ({
			title: `Chart ${index + 1} of ${count}`,
			image: { url },
		})),
	})

const imageGrids = [2, 3, 4, 5, 6, 7, 8, 9, 10, 14].map(imageGrid)

const mixedRun = row({
	name: "Maple",
	isBot: true,
	content:
		"**Mixed:** two images, an alert card, then three more images. Each run of images is its own grid.",
	embeds: [
		...pictures(2, 1).map((url) => ({ image: { url } })),
		{
			title: "High error rate on maple-cli",
			color: 0xef3b4a,
			description: "Error rate is **5.55%**, above the 5% threshold.",
			fields: [{ name: "Signal", value: "Error rate", inline: true }],
		},
		...pictures(3, 4).map((url) => ({ image: { url } })),
	],
})

const attachmentGrid = (count: number) =>
	row({
		name: "Ada Lovelace",
		content: `${count} photos attached`,
		attachments: pictures(count, count + 2).map((url, index) => ({
			id: `attachment-${count}-${index}`,
			fileName: `photo-${index + 1}.png`,
			fileSize: 1024,
			url,
		})) as unknown as MessageRow["attachments"],
	})

const human = row({
	name: "Ada Lovelace",
	content:
		"yes dig into maple-cli first 🙏 also @[userId:u-ada] can you check the `pool_size` env var?\n\nhttps://github.com/MapleTechLabs/hazel/blob/main/apps/backend/src/worker/objects/channel-object-with-a-very-long-path-name.ts",
})

const emojiOnly = row({ name: "Ada Lovelace", content: "🔥🔥" })

const gridsOnly = (h: HtmlBuilder<M>) =>
	h.div(
		[h.Id("grids"), h.Class("w-[700px] bg-bg px-6 py-4 font-sans text-fg antialiased")],
		[...imageGrids, mixedRun, attachmentGrid(2), attachmentGrid(4), attachmentGrid(12)].map((message) =>
			messageRowView(h, message, context(h)),
		),
	)

const screen = (h: HtmlBuilder<M>) => {
	const rowContext = context(h)
	return h.div(
		[h.Id("lab"), h.Class("w-full max-w-[1100px] bg-bg px-6 py-4 font-sans text-fg antialiased")],
		[
			mapleHealth,
			imageCards,
			...imageGrids,
			mixedRun,
			attachmentGrid(2),
			attachmentGrid(4),
			attachmentGrid(12),
			richMarkdown,
			alertCard,
			approvalCard,
			githubCard,
			linkPreview,
			human,
			emojiOnly,
		].map((message) => messageRowView(h, message, rowContext)),
	)
}

/** A selector with its pseudo-classes and elements removed, to test against the rendered lab. */
const structuralSelector = (selector: string) =>
	selector.replace(/::?[a-z-]+(\([^()]*\))?/g, "").replace(/(^|[\s>+~,(])(?=[\s>+~,)]|$)/g, "$1*")

/** The rules the lab uses, from the stylesheets the page loaded (fonts left to the system font). */
const usedCss = (rules: CSSRuleList): string => {
	let css = ""
	for (const rule of rules) {
		if (rule instanceof CSSFontFaceRule) continue
		if (rule instanceof CSSStyleRule) {
			try {
				if (document.querySelector(structuralSelector(rule.selectorText))) css += rule.cssText
			} catch {
				css += rule.cssText
			}
		} else if (rule instanceof CSSMediaRule) {
			const inner = usedCss(rule.cssRules)
			if (inner) css += `@media ${rule.conditionText}{${inner}}`
		} else if (rule instanceof CSSSupportsRule) {
			const inner = usedCss(rule.cssRules)
			if (inner) css += `@supports ${rule.conditionText}{${inner}}`
		} else if (rule instanceof CSSLayerBlockRule) {
			css += `@layer ${rule.name}{${usedCss(rule.cssRules)}}`
		} else css += rule.cssText
	}
	return css
}

/** Custom properties nothing in the kept CSS reads, dropped from it (the theme declares hundreds). */
const withoutUnusedVariables = (css: string) => {
	let result = css.replace(/\s+/g, " ")
	for (let pass = 0; pass < 3; pass++) {
		const used = new Set([...result.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]))
		result = result.replace(/(--[\w-]+):[^;{}]*;?/g, (declaration, name: string) =>
			used.has(name) ? declaration : "",
		)
	}
	return result
}

const pageHtml = (lab: HTMLElement) => {
	const css = withoutUnusedVariables(
		[...document.styleSheets].map((sheet) => usedCss(sheet.cssRules)).join(""),
	)
	const copy = lab.cloneNode(true) as HTMLElement
	for (const element of [copy, ...copy.querySelectorAll("*")])
		for (const { name } of Array.from(element.attributes))
			if (/^data-slate|^data-react|^contenteditable$|^translate$|^zindex$|^data-id$/.test(name))
				element.removeAttribute(name)
	const body = copy.outerHTML
	return `<!doctype html><html class="dark"><head><meta charset="utf-8"><title>Message lab</title><style>${css}</style><style>body{margin:0}.lab-bar{display:flex;align-items:center;gap:8px;padding:8px 24px;font-size:13px}</style></head><body class="bg-bg text-fg"><div class="lab-bar border-b border-border"><strong>Message lab</strong><button onclick="document.documentElement.classList.toggle('dark')" class="ml-auto rounded-md border border-border px-2 py-0.5">Light / dark</button></div>${body}</body></html>`
}

for (const theme of ["light", "dark"] as const) {
	test(theme, { timeout: 60_000 }, async () => {
		if (theme === "dark") document.documentElement.classList.add("dark")
		render(screen)
		await document.fonts.ready
		const lab = document.getElementById("lab")!
		// Lazy images load only on screen: show the whole lab first, then wait for them.
		for (const image of document.images) image.loading = "eager"
		await page.viewport(1180, lab.scrollHeight)
		await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)))
		await page.viewport(1180, lab.scrollHeight)
		await page.screenshot({ path: `messages-${theme}.png`, element: lab })
		if (theme === "dark") await commands.writeFile("messages-lab.html", pageHtml(lab))
	})
}

test("viewer", async () => {
	document.documentElement.classList.add("dark")
	render((h) =>
		imageViewerView(h, {
			images: [
				{
					id: "chart",
					fileName: "Service error rate (last 6h)",
					fileSize: 0,
					url: tallChart,
					caption: {
						title: "Service error rate (last 6h)",
						description: "17 items, highest electric-sync (61.8)",
					},
				},
			],
			index: 0,
			author: { name: "Maple", avatarUrl: null, seed: "Maple" },
			createdAtMs: BASE_TIME,
			toClose: never,
			toSelect: never,
		}),
	)
	await page.viewport(1180, 860)
	await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)))
	await page.screenshot({ path: "messages-viewer.png" })
})

for (const theme of ["light", "dark"] as const) {
	test(`grids ${theme}`, { timeout: 60_000 }, async () => {
		if (theme === "dark") document.documentElement.classList.add("dark")
		render(gridsOnly)
		await document.fonts.ready
		for (const image of document.images) image.loading = "eager"
		await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)))
		// One shot per message: a page this tall is scaled down when shot whole.
		await page.viewport(800, 1200)
		const messages = [...document.querySelectorAll<HTMLElement>("#grids [id^=message-]")]
		for (const [index, message] of messages.entries())
			await page.screenshot({
				path: `grids/${theme}-${String(index).padStart(2, "0")}.png`,
				element: message,
			})
	})
}
