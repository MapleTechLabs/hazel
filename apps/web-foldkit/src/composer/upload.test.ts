import { AttachmentId, ChannelId, OrganizationId } from "@hazel/schema"
import { Effect, Fiber, Layer, Schema, Stream } from "effect"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { HazelApiClient, HazelRpc } from "../rpc"
import { UploadEvent, uploadStream } from "./upload"

/** The upload Stream against a fake XHR and fake clients: how it ends, and that stopping it aborts (P0). */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const attachmentId = Schema.decodeSync(AttachmentId)(uuid(7001))
const args = {
	fileId: "f1",
	file: new File(["png"], "diagram.png", { type: "image/png" }),
	organizationId: Schema.decodeSync(OrganizationId)(uuid(4)),
	channelId: Schema.decodeSync(ChannelId)(uuid(1)),
}

/** An XHR that does nothing until the test settles it. */
class FakeXhr {
	static last: FakeXhr | null = null
	timeout = 0
	status = 0
	isAborted = false
	isSent = false
	upload: {
		onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null
	} = {
		onprogress: null,
	}
	onload: (() => void) | null = null
	onerror: (() => void) | null = null
	ontimeout: (() => void) | null = null
	constructor() {
		FakeXhr.last = this
	}
	open() {}
	setRequestHeader() {}
	send() {
		this.isSent = true
	}
	abort() {
		this.isAborted = true
	}
}

const rpcCalls: Array<readonly [string, unknown]> = []

const clients = Layer.mergeAll(
	Layer.succeed(HazelApiClient, {
		uploads: {
			presign: () =>
				Effect.succeed({ uploadUrl: "https://storage.test/put", resourceId: attachmentId, key: "k" }),
		},
	} as never),
	Layer.succeed(HazelRpc, ((name: string, payload: unknown) =>
		Effect.sync(() => {
			rpcCalls.push([name, payload])
		})) as never),
)

const waitForSend = Effect.gen(function* () {
	while (FakeXhr.last?.isSent !== true) yield* Effect.sleep("1 millis")
	return FakeXhr.last
})

beforeEach(() => {
	FakeXhr.last = null
	rpcCalls.length = 0
	vi.stubGlobal("XMLHttpRequest", FakeXhr)
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("uploadStream", () => {
	test("a stored file is completed and reported with its attachment", async () => {
		const events = await Effect.gen(function* () {
			const fiber = yield* uploadStream(args).pipe(Stream.take(2), Stream.runCollect, Effect.forkChild)
			const xhr = yield* waitForSend
			xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 })
			xhr.status = 200
			xhr.onload?.()
			return yield* Fiber.join(fiber)
		}).pipe(Effect.provide(clients), Effect.runPromise)
		expect(events).toEqual([
			UploadEvent.ProgressedUpload({ fileId: "f1", progress: 50 }),
			UploadEvent.SucceededUpload({ fileId: "f1", attachmentId }),
		])
		expect(rpcCalls).toEqual([["attachment.complete", { id: attachmentId, channelId: args.channelId }]])
	})

	test("a network failure is a typed reason, and the attachment is marked failed", async () => {
		const events = await Effect.gen(function* () {
			const fiber = yield* uploadStream(args).pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
			const xhr = yield* waitForSend
			xhr.onerror?.()
			return yield* Fiber.join(fiber)
		}).pipe(Effect.provide(clients), Effect.runPromise)
		expect(events).toEqual([UploadEvent.FailedUpload({ fileId: "f1", reason: "StorageNetwork" })])
		expect(rpcCalls).toEqual([
			[
				"attachment.fail",
				{
					id: attachmentId,
					channelId: args.channelId,
					reason: "Storage upload failed: StorageNetwork",
				},
			],
		])
	})

	test("stopping the Stream mid-upload aborts the request and marks the attachment cancelled", async () => {
		const xhr = await Effect.gen(function* () {
			const fiber = yield* uploadStream(args).pipe(Stream.runDrain, Effect.forkChild)
			const sent = yield* waitForSend
			yield* Fiber.interrupt(fiber)
			return sent
		}).pipe(Effect.provide(clients), Effect.runPromise)
		expect(xhr.isAborted).toBe(true)
		expect(rpcCalls).toEqual([
			["attachment.fail", { id: attachmentId, channelId: args.channelId, reason: "Upload cancelled" }],
		])
	})

	test("a file over the limit fails before anything is uploaded", async () => {
		const big = { ...args, file: new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.bin") }
		const events = await uploadStream(big).pipe(
			Stream.take(1),
			Stream.runCollect,
			Effect.provide(clients),
			Effect.runPromise,
		)
		expect(events).toEqual([UploadEvent.FailedUpload({ fileId: "f1", reason: "FileTooLarge" })])
		expect(FakeXhr.last).toBeNull()
	})
})
