import { createHash } from "node:crypto"
import { PNG } from "pngjs"
import { corsHeaders } from "./electric.ts"

/**
 * Fixture images under `/r2/*` (the `VITE_R2_PUBLIC_URL` base): attachments, avatars, custom emojis
 * and embed icons. Each path renders a flat-colour PNG, so captures never depend on the network.
 * Size comes from an optional `-<w>x<h>` suffix (`/r2/photo-640x400.png`), default 256x256.
 */

const cache = new Map<string, Buffer>()

const renderPng = (path: string): Buffer => {
	const size = path.match(/-(\d{1,4})x(\d{1,4})\.\w+$/)
	const width = Math.min(Number(size?.[1] ?? 256), 2048)
	const height = Math.min(Number(size?.[2] ?? 256), 2048)
	const hash = createHash("sha1").update(path).digest()
	const png = new PNG({ width, height })
	// One flat colour per path: any resampling of a flat image gives the same pixels, so scaled
	// avatars, emojis and thumbnails rasterize identically on every capture.
	for (let offset = 0; offset < width * height * 4; offset += 4) {
		png.data[offset] = hash[0]!
		png.data[offset + 1] = hash[1]!
		png.data[offset + 2] = hash[2]!
		png.data[offset + 3] = 255
	}
	return PNG.sync.write(png)
}

export const isAssetRequest = (url: URL) => url.pathname.startsWith("/r2/")

export const handleAsset = (request: Request, url: URL): Response => {
	if (!/\.(png|jpg|jpeg|gif|webp)$/i.test(url.pathname))
		return new Response("not found", { status: 404, headers: corsHeaders(request) })
	let body = cache.get(url.pathname)
	if (!body) {
		body = renderPng(url.pathname)
		cache.set(url.pathname, body)
	}
	// Always PNG bytes; browsers sniff the content, whatever the extension says.
	return new Response(new Uint8Array(body), {
		headers: { ...corsHeaders(request), "content-type": "image/png", "cache-control": "no-store" },
	})
}
