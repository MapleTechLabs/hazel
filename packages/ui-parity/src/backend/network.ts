import type { Dataset } from "../fixtures/dataset.ts"
import { fixtureImage } from "./assets.ts"
import { corsHeaders } from "./electric.ts"

/**
 * Third-party services message content reaches, served from the dataset so captures never touch
 * the network: the link-preview worker (unfurls and tweets), GIF CDNs and the YouTube player.
 * `capture.ts` fulfils requests to these hosts from `/net/<host><path>` on the fixture backend.
 */

export const NETWORK_FIXTURE_HOSTS: ReadonlySet<string> = new Set([
	"link-preview.hazel.sh",
	"media.giphy.com",
	"media0.giphy.com",
	"media1.giphy.com",
	"media2.giphy.com",
	"media3.giphy.com",
	"media4.giphy.com",
	"i.giphy.com",
	"static.klipy.com",
	"www.youtube.com",
])

export const NETWORK_PREFIX = "/net/"

/** Where the fixture backend serves a request to one of `NETWORK_FIXTURE_HOSTS`. */
export const networkFixturePath = (url: URL) => `${NETWORK_PREFIX}${url.hostname}${url.pathname}${url.search}`

export const isNetworkRequest = (url: URL) => url.pathname.startsWith(NETWORK_PREFIX)

const notFound = (request: Request) =>
	// 404 is the console noise the harness already ignores; the apps treat any failure the same.
	new Response("not found", { status: 404, headers: corsHeaders(request) })

const json = (request: Request, body: unknown) =>
	Response.json(body, { headers: { ...corsHeaders(request), "cache-control": "no-store" } })

/** A stand-in for the embedded YouTube player: a flat frame naming the video. */
const youtubePlayer = (videoId: string) =>
	`<!doctype html><html><head><meta charset="utf-8"><title>YouTube</title></head>` +
	`<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;` +
	`background:#0f0f0f;color:#f1f1f1;font:600 16px/1.2 sans-serif">` +
	`<div style="display:flex;flex-direction:column;align-items:center;gap:12px">` +
	`<div style="width:68px;height:48px;border-radius:12px;background:#f00;display:flex;align-items:center;justify-content:center">` +
	`<div style="width:0;height:0;border-style:solid;border-width:10px 0 10px 18px;border-color:transparent transparent transparent #fff"></div></div>` +
	`<div>${videoId.replace(/[^\w-]/g, "")}</div></div></body></html>`

export const handleNetwork = (request: Request, url: URL, dataset: Dataset): Response => {
	const rest = url.pathname.slice(NETWORK_PREFIX.length)
	const slash = rest.indexOf("/")
	const host = slash === -1 ? rest : rest.slice(0, slash)
	const path = slash === -1 ? "/" : rest.slice(slash)

	if (host === "link-preview.hazel.sh") {
		if (path === "/link-preview") {
			const preview = dataset.network?.linkPreviews?.[url.searchParams.get("url") ?? ""]
			return preview === undefined ? notFound(request) : json(request, preview)
		}
		if (path === "/tweet") {
			const tweet = dataset.network?.tweets?.[url.searchParams.get("id") ?? ""]
			return tweet === undefined ? notFound(request) : json(request, tweet)
		}
		return notFound(request)
	}
	if (host === "www.youtube.com") {
		const videoId = path.match(/^\/embed\/([^/?#]+)/)?.[1]
		return videoId === undefined
			? notFound(request)
			: new Response(youtubePlayer(videoId), {
					headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
				})
	}
	// GIF CDNs: a flat image per URL; a `-<w>x<h>` suffix on the file name sets the size.
	return fixtureImage(request, `/net/${host}${path}`, [480, 270])
}
