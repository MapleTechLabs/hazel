/**
 * The browser's `FilesHost` for the Files and All media pages (`shared-screens/src/chat/files`):
 * today's download link, new tab, image and text copies, and the Tailwind breakpoints by `matchMedia`.
 */
import { FilesHost, FilesHostError } from "@hazel/shared-screens/chat/files/actions"
import type { Breakpoint } from "@hazel/shared-screens/chat/files/attachments"
import { Effect, Layer, Queue, Stream } from "effect"

/** The image as PNG, the one type every clipboard takes (as the channel's `CopyImage`). */
const fetchPng = async (url: string): Promise<Blob> => {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`HTTP ${response.status}`)
	const blob = await response.blob()
	if (blob.type === "image/png") return blob
	const bitmap = await createImageBitmap(blob)
	const canvas = document.createElement("canvas")
	canvas.width = bitmap.width
	canvas.height = bitmap.height
	canvas.getContext("2d")?.drawImage(bitmap, 0, 0)
	bitmap.close()
	return new Promise((resolve, reject) =>
		canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("toBlob"))), "image/png"),
	)
}

const queries: ReadonlyArray<readonly [Breakpoint, string]> = [
	["xl", "(min-width: 1280px)"],
	["lg", "(min-width: 1024px)"],
	["sm", "(min-width: 640px)"],
]

const current = (): Breakpoint => queries.find(([, query]) => matchMedia(query).matches)?.[0] ?? "base"

const breakpoint = Stream.callback<Breakpoint>((queue) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			const lists = queries.map(([, query]) => matchMedia(query))
			const emit = () => Queue.offerUnsafe(queue, current())
			lists.forEach((list) => list.addEventListener("change", emit))
			emit()
			return () => lists.forEach((list) => list.removeEventListener("change", emit))
		}),
		(release) => Effect.sync(release),
	).pipe(Effect.flatMap(() => Effect.never)),
)

const clipboard = <A>(write: (clipboard: Clipboard) => Promise<A>) =>
	Effect.suspend(() => {
		const target = typeof navigator === "undefined" ? undefined : navigator.clipboard
		return target === undefined
			? Effect.fail(new FilesHostError({ reason: "unavailable" }))
			: Effect.tryPromise({
					try: () => write(target),
					catch: () => new FilesHostError({ reason: "denied" }),
				}).pipe(Effect.asVoid)
	})

export const filesHostLayer = Layer.succeed(
	FilesHost,
	FilesHost.of({
		download: (url, fileName) =>
			Effect.sync(() => {
				const link = document.createElement("a")
				link.href = url
				link.download = fileName
				link.target = "_blank"
				document.body.appendChild(link)
				link.click()
				document.body.removeChild(link)
			}),
		open: (url) =>
			Effect.sync(() => {
				window.open(url, "_blank")
			}),
		copyImage: (url) =>
			clipboard((target) => target.write([new ClipboardItem({ "image/png": fetchPng(url) })])),
		copyText: (text) => clipboard((target) => target.writeText(text)),
		breakpoint,
	}),
)
