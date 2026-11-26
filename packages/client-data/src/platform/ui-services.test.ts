/** Files and Clipboard on both hosts, over a fake API (presign over HTTP, complete and fail over RPC). */
import { AttachmentId, ChannelId, OrganizationId } from "@hazel/schema"
import { Effect, Exit, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { afterEach, describe, expect, test, vi } from "vitest"
import { HazelRpc } from "../rpc"
import type { NativeBridge, NativeFile } from "./jsc/bridge"
import { makeFakeBridge } from "./jsc/fake-bridge"
import { ClipboardJsc, makeFilesJsc } from "./jsc/ui-services"
import { ClientDataConfig, Session } from "./services"
import { Clipboard, Files } from "./ui-services"
import { ClipboardWeb, FilesWeb, holdDroppedFiles } from "./web/ui-services"

const attachmentId = AttachmentId.make("00000000-0000-4000-8000-0000000000a1")
const target = {
	organizationId: OrganizationId.make("00000000-0000-4000-8000-0000000000b1"),
	channelId: ChannelId.make("00000000-0000-4000-8000-0000000000c1"),
}

/** The API: presign answers `presignStatus`, the RPCs are recorded. */
const fakeApi = (presignStatus = 200) => {
	const presigns: Array<{ url: string; body: unknown; authorization: string | undefined }> = []
	const rpcs: Array<{ tag: string; payload: unknown }> = []
	const http = HttpClient.make((request, url) =>
		Effect.sync(() => {
			const body =
				request.body._tag === "Uint8Array"
					? JSON.parse(new TextDecoder().decode(request.body.body))
					: null
			presigns.push({ url: url.href, body, authorization: request.headers.authorization })
			return HttpClientResponse.fromWeb(
				request,
				new Response(
					JSON.stringify({
						uploadUrl: "https://storage.test/put",
						key: "k",
						publicUrl: "p",
						resourceId: attachmentId,
					}),
					{
						status: presignStatus,
						headers: { "content-type": "application/json" },
					},
				),
			)
		}),
	)
	const rpc = (tag: string, payload: unknown) => {
		rpcs.push({ tag, payload })
		return Effect.succeed(undefined)
	}
	const layer = Layer.mergeAll(
		Layer.succeed(HttpClient.HttpClient, http),
		// SAFETY: the flow calls only `attachment.complete` and `attachment.fail`, which `rpc` records.
		Layer.succeed(HazelRpc, rpc as unknown as HazelRpc["Service"]),
		Layer.succeed(Session, {
			getAccessToken: async () => null,
			invalidateAccessToken: () => {},
			authorization: Effect.succeed("Bearer s"),
		}),
		Layer.succeed(ClientDataConfig, { apiUrl: "http://api.test", isRetryableError: () => false }),
	)
	return { layer, presigns, rpcs }
}

const run = <A, E>(effect: Effect.Effect<A, E, Files>, layer: Layer.Layer<Files>) =>
	Effect.runPromiseExit(Effect.provide(effect, layer))

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("Files on iOS", () => {
	const photo: NativeFile = {
		handle: "h1",
		name: "photo.png",
		size: 1200,
		type: "image/png",
		kind: "image",
		width: 40,
		height: 30,
	}

	const native = (picked: Array<NativeFile> | null, uploadStatus = 200) => {
		const fake = makeFakeBridge()
		const uploads: Array<{ handle: string; url: string; contentType: string }> = []
		const released: Array<string> = []
		const bridge: NativeBridge = {
			...fake.bridge,
			files: {
				pick: (_accept, _multiple, done) =>
					setTimeout(() => done(picked, picked === null ? "denied" : null), 0),
				takeDropped: () => [
					{ ...photo, handle: "d1", name: "page.html", type: "text/html", kind: "file" },
				],
				upload: (handle, url, contentType, done) => {
					uploads.push({ handle, url, contentType })
					setTimeout(() => done(uploadStatus, null), 0)
					return 1
				},
				cancel: () => {},
				release: (handle) => void released.push(handle),
			},
			clipboard: { write: (text) => text !== "refuse" },
		}
		return { bridge, uploads, released }
	}

	test("pick presigns, uploads from disk, completes, and lets go of the copy", async () => {
		const api = fakeApi()
		const { bridge, uploads, released } = native([photo])
		const files = makeFilesJsc({ target: () => target, bridge: () => bridge }).pipe(
			Layer.provide(api.layer),
		)
		const exit = await run(
			Files.use((f) => f.pick({ accept: "media", multiple: true })),
			files,
		)
		expect(exit).toEqual(
			Exit.succeed([
				{ attachmentId, name: "photo.png", kind: "image", size: 1200, width: 40, height: 30 },
			]),
		)
		expect(api.presigns[0]).toMatchObject({
			url: "http://api.test/uploads/presign",
			authorization: "Bearer s",
			body: {
				type: "attachment",
				fileName: "photo.png",
				fileSize: 1200,
				contentType: "image/png",
				...target,
			},
		})
		expect(uploads).toEqual([{ handle: "h1", url: "https://storage.test/put", contentType: "image/png" }])
		expect(api.rpcs).toEqual([
			{ tag: "attachment.complete", payload: { id: attachmentId, channelId: target.channelId } },
		])
		expect(released).toEqual(["h1"])
	})

	test("a dropped HTML file is stored as plain bytes; a failed PUT marks the attachment failed", async () => {
		const api = fakeApi()
		const { bridge, uploads, released } = native([], 500)
		const files = makeFilesJsc({ target: () => target, bridge: () => bridge }).pipe(
			Layer.provide(api.layer),
		)
		const exit = await run(
			Files.use((f) => f.dropped),
			files,
		)
		expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("uploadFailed")
		expect(uploads[0]!.contentType).toBe("application/octet-stream")
		expect(api.rpcs.map((call) => call.tag)).toEqual(["attachment.fail"])
		expect(released).toEqual(["d1"])
	})

	test("a cancelled pick is empty; a refused one is denied; no composer is uploadFailed", async () => {
		const api = fakeApi()
		const pick = (picked: Array<NativeFile> | null, to: typeof target | undefined) =>
			run(
				Files.use((f) => f.pick({ accept: "any", multiple: false })),
				makeFilesJsc({ target: () => to, bridge: () => native(picked).bridge }).pipe(
					Layer.provide(api.layer),
				),
			)
		expect(await pick([], target)).toEqual(Exit.succeed([]))
		expect(JSON.stringify(await pick(null, target))).toContain("denied")
		expect(JSON.stringify(await pick([photo], undefined))).toContain("uploadFailed")
		expect(api.presigns).toHaveLength(0)
	})

	test("too large a file never reaches the API", async () => {
		const api = fakeApi()
		const { bridge } = native([{ ...photo, size: 11 * 1024 * 1024 }])
		const exit = await run(
			Files.use((f) => f.pick({ accept: "any", multiple: false })),
			makeFilesJsc({ target: () => target, bridge: () => bridge }).pipe(Layer.provide(api.layer)),
		)
		expect(JSON.stringify(exit)).toContain("tooLarge")
		expect(api.presigns).toHaveLength(0)
	})

	test("Clipboard writes to the pasteboard", async () => {
		const { bridge } = native([])
		vi.stubGlobal("__native", bridge)
		const write = (text: string) =>
			Effect.runPromiseExit(
				Effect.provide(
					Clipboard.use((c) => c.write(text)),
					ClipboardJsc,
				),
			)
		expect(await write("https://app.hazel.sh/acme")).toEqual(Exit.void)
		expect(JSON.stringify(await write("refuse"))).toContain("denied")
	})
})

describe("Files and Clipboard on the web", () => {
	test("pick and dropped upload the browser's File with fetch", async () => {
		const api = fakeApi()
		const puts: Array<{ url: string; type: string | null }> = []
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				puts.push({ url, type: new Headers(init.headers).get("content-type") })
				return new Response(null, { status: 200 })
			}),
		)
		const file = new File(["hello"], "notes.txt", { type: "text/plain" })
		const files = FilesWeb({ target: () => target, pick: () => Effect.succeed([file]) }).pipe(
			Layer.provide(api.layer),
		)
		const picked = await run(
			Files.use((f) => f.pick({ accept: "any", multiple: true })),
			files,
		)
		expect(picked).toEqual(Exit.succeed([{ attachmentId, name: "notes.txt", kind: "file", size: 5 }]))
		holdDroppedFiles([new File(["<b>x</b>"], "x.svg", { type: "image/svg+xml" })])
		const dropped = await run(
			Files.use((f) => f.dropped),
			files,
		)
		expect(Exit.isSuccess(dropped)).toBe(true)
		// Taken once: a second take is empty.
		expect(
			await run(
				Files.use((f) => f.dropped),
				files,
			),
		).toEqual(Exit.succeed([]))
		expect(puts).toEqual([
			{ url: "https://storage.test/put", type: "text/plain" },
			{ url: "https://storage.test/put", type: "application/octet-stream" },
		])
		expect(api.rpcs.map((call) => call.tag)).toEqual(["attachment.complete", "attachment.complete"])
	})

	test("a refused presign fails the pick without a PUT", async () => {
		const api = fakeApi(403)
		const fetchSpy = vi.fn()
		vi.stubGlobal("fetch", fetchSpy)
		const files = FilesWeb({
			target: () => target,
			pick: () => Effect.succeed([new File(["x"], "a.txt", { type: "text/plain" })]),
		}).pipe(Layer.provide(api.layer))
		const exit = await run(
			Files.use((f) => f.pick({ accept: "any", multiple: false })),
			files,
		)
		expect(JSON.stringify(exit)).toContain("uploadFailed")
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	test("Clipboard uses navigator.clipboard, and says why it could not", async () => {
		const write = (text: string) =>
			Effect.runPromiseExit(
				Effect.provide(
					Clipboard.use((c) => c.write(text)),
					ClipboardWeb,
				),
			)
		const writeText = vi.fn(async (text: string) => {
			if (text === "refuse") throw new DOMException("no", "NotAllowedError")
		})
		vi.stubGlobal("navigator", { clipboard: { writeText } })
		expect(await write("hi")).toEqual(Exit.void)
		expect(writeText).toHaveBeenCalledWith("hi")
		expect(JSON.stringify(await write("refuse"))).toContain("denied")
		vi.stubGlobal("navigator", {})
		expect(JSON.stringify(await write("hi"))).toContain("unavailable")
	})
})
