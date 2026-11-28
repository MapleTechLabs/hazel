import { injectHtmlRenderBootstrap } from "@hazel/domain/html-render"
import { initialLiveState } from "@hazel/domain/live"
import type { PageFixture } from "../page-fixture"
import { generalChannelId, generalMessageRows, userRows } from "../snapshot"

/**
 * `#general` ending in rich content (lane PC6): a bot card with a picture, a link that unfurls, an
 * HTML render and a reply that is still streaming, its progress pinned so the shot is the same each run.
 */

/** Minutes before the parity harness's pinned clock (`compare-pages.ts` `FIXED_NOW`). */
const at = (minutesBefore: number) =>
	new Date(Date.parse("2026-11-26T15:00:00Z") - minutesBefore * 60_000).toISOString()

const id = (n: number) => `00000000-0000-4000-8000-0000000c00${String(n).padStart(2, "0")}`
const RENDER_ID = "00000000-0000-4000-8000-0000000c0101"
const STREAMING_ID = id(4)
const LINK = "https://hazel.test/blog/offsite-notes"

const template = generalMessageRows.at(-1)
const [, grace, , dennis] = userRows

const message = (
	n: number,
	authorId: string | undefined,
	minutesBefore: number,
	content: string,
	embeds: unknown,
) => ({
	...template,
	id: id(n),
	channelId: generalChannelId,
	authorId,
	content,
	embeds,
	replyToMessageId: null,
	threadChannelId: null,
	createdAt: at(minutesBefore),
	updatedAt: null,
})

/** A small page that reports its height, as a bot's report would. */
const REPORT = `<!doctype html><html><head><style>
body { margin: 0; padding: 8px; font: 14px var(--font-sans); color: var(--foreground); }
.card { border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.row { display: flex; justify-content: space-between; padding: 4px 0; }
</style></head><body><div class="card"><strong>Weekly report</strong>
<div class="row"><span>Messages</span><span>1,284</span></div>
<div class="row"><span>Threads</span><span>96</span></div>
<div class="row"><span>Median reply</span><span>4m</span></div></div></body></html>`

const fixture: PageFixture = {
	seed: (server) =>
		server.write("channel", generalChannelId, "messages", [
			message(1, grace?.id, 40, "Deploy finished.", [
				{
					title: "Production deploy",
					description: "web 1.42.0 is live.",
					url: "https://hazel.test/deploys/1420",
					author: { name: "Deploy bot" },
					fields: [{ name: "Duration", value: "3m 12s" }],
				},
				{ image: { url: "/images/squirrle_window.webp" }, title: "Latency" },
			]),
			message(2, dennis?.id, 30, `Notes from the offsite ${LINK}`, null),
			message(3, grace?.id, 20, "", [
				{ html: { renderId: RENDER_ID, title: "Weekly report", height: 160 } },
			]),
			message(4, dennis?.id, 10, "", [{ liveState: { enabled: true, loading: { text: "Thinking" } } }]),
		]),
	rpcs: {
		"message.htmlRenderUrl": () => ({
			url: `data:text/html;charset=utf-8,${encodeURIComponent(injectHtmlRenderBootstrap(REPORT))}`,
			expiresAt: Date.parse("2026-11-26T16:00:00Z"),
		}),
	},
	unfurls: (url) =>
		url.pathname === "/link-preview" && url.searchParams.get("url") === LINK
			? {
					url: LINK,
					title: "What we decided at the offsite",
					description: "Three days, one roadmap: the composer, sync and the new home.",
					image: { url: "/images/squirrle_ocean.webp" },
				}
			: undefined,
	live: (messageId) =>
		messageId === STREAMING_ID
			? [
					{
						_tag: "Snapshot",
						state: {
							...initialLiveState,
							status: "active",
							isStreaming: true,
							text: "Here is the week in short:\n\n- The composer shipped\n- Sync moved to the objects",
						},
					},
				]
			: undefined,
}

export default fixture
