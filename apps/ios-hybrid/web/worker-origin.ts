/**
 * The page's workers on the page's own origin. The page is one inlined file (`vite.config.mts`), so a
 * worker's script is a `data:` URL, and WebKit gives a worker started from one an opaque origin: there
 * the local cache's OPFS worker is refused storage (`SecurityError`), the cache turns itself off and
 * the page reloads (`web-foldkit/src/core/db/local-cache.ts`), and every launch waits on the network
 * for rows the cache would have drawn at once. Started from a `blob:` URL instead, a worker keeps the
 * origin of the page that made it.
 */

/** The bytes and type a `data:` URL holds, or `undefined` for any other URL. */
export const dataUrlContent = (url: string): { type: string; bytes: Uint8Array<ArrayBuffer> } | undefined => {
	const match = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(url)
	if (match === null) return undefined
	const [, type = "", isBase64, payload = ""] = match
	const bytes = isBase64
		? Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
		: new TextEncoder().encode(decodeURIComponent(payload))
	return { type: type.split(";")[0] || "text/javascript", bytes }
}

export const installWorkerOrigin = () => {
	const Base = globalThis.Worker
	if (Base === undefined) return
	class PageOriginWorker extends Base {
		constructor(url: string | URL, options?: WorkerOptions) {
			const content = dataUrlContent(String(url))
			super(
				content === undefined
					? url
					: URL.createObjectURL(new Blob([content.bytes], { type: content.type })),
				options,
			)
		}
	}
	globalThis.Worker = PageOriginWorker
}
