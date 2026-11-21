/**
 * The api Worker's `email` handler body (`worker.ts`), loaded on the first email: the inbound
 * handler over the Worker's directory, its object stubs and env.
 */
import { workerEnvLayer } from "@hazel/infra/worker-runtime"
import { Effect, Layer } from "effect"
import { directoryBinding } from "../../worker/platform"
import { workerObjectStubs } from "../../worker/objects/stubs"
import { Directory } from "../directory"
import { type InboundEmailMessage, receiveInboundEmail } from "./inbound"

export const receiveWorkerEmail = (message: InboundEmailMessage, env: Record<string, unknown>) =>
	receiveInboundEmail(message).pipe(
		Effect.provide(
			Layer.mergeAll(
				workerObjectStubs(env),
				Layer.suspend(() => Directory.layerD1(directoryBinding(env))),
				workerEnvLayer(env),
			),
		),
	)

/** What `readStream` reads: workerd's byte stream, whichever type package names it. */
interface ByteStream {
	readonly getReader: () => {
		readonly read: () => Promise<{ readonly done: boolean; readonly value?: Uint8Array | undefined }>
	}
}

/** A message's raw bytes, read to the end (Email Routing hands them over as a stream). */
export const readStream = async (stream: ByteStream): Promise<ArrayBuffer> => {
	const reader = stream.getReader()
	const chunks: Array<Uint8Array> = []
	let size = 0
	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		if (value !== undefined) {
			chunks.push(value)
			size += value.byteLength
		}
	}
	const bytes = new Uint8Array(size)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	return bytes.buffer
}
