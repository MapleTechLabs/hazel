import type { ServerWebSocket } from "bun"
import type { ActorScript, Dataset } from "../fixtures/dataset.ts"
import { corsHeaders } from "./electric.ts"

/**
 * A stand-in for the Rivet manager and the `message` actor (`VITE_RIVET_URL` is `<backend>/rivet`),
 * speaking RivetKit 2.1's client protocol: `GET /metadata`, `PUT /actors` (getOrCreate), and the
 * `/gateway/<actorId>/connect` WebSocket with BARE framing and CBOR payloads. Each message's actor
 * answers `getState` with its script's snapshot, then streams the script's events.
 */

export const RIVET_PREFIX = "/rivet/"
export const isRivetRequest = (url: URL) => url.pathname.startsWith(RIVET_PREFIX)

export interface RivetSocketData {
	readonly datasetName: string
	readonly messageId: string
}

// MARK: CBOR (the subset event payloads use: maps, arrays, strings, numbers, booleans, null)

const cborHead = (major: number, length: number): number[] => {
	if (length < 24) return [(major << 5) | length]
	if (length < 0x100) return [(major << 5) | 24, length]
	if (length < 0x10000) return [(major << 5) | 25, length >> 8, length & 0xff]
	return [(major << 5) | 26, (length >>> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]
}

const encodeCbor = (value: unknown): number[] => {
	if (value === null || value === undefined) return [0xf6]
	if (value === false) return [0xf4]
	if (value === true) return [0xf5]
	if (typeof value === "number") {
		if (Number.isInteger(value) && Math.abs(value) < 2 ** 32)
			return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value)
		const view = new DataView(new ArrayBuffer(8))
		view.setFloat64(0, value)
		return [0xfb, ...new Uint8Array(view.buffer)]
	}
	if (typeof value === "string") {
		const bytes = new TextEncoder().encode(value)
		return [...cborHead(3, bytes.length), ...bytes]
	}
	if (Array.isArray(value)) return [...cborHead(4, value.length), ...value.flatMap(encodeCbor)]
	const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
	return [...cborHead(5, entries.length), ...entries.flatMap(([key, item]) => [...encodeCbor(key), ...encodeCbor(item)])]
}

// MARK: BARE (client-protocol v3, with vbare's little-endian u16 version prefix)

const PROTOCOL_VERSION = 3

const uvarint = (value: number): number[] => {
	const bytes: number[] = []
	let rest = value
	while (rest >= 0x80) {
		bytes.push((rest & 0x7f) | 0x80)
		rest = Math.floor(rest / 0x80)
	}
	bytes.push(rest)
	return bytes
}
const bareData = (bytes: ArrayLike<number>) => [...uvarint(bytes.length), ...Array.from(bytes)]
const bareString = (text: string) => bareData(new TextEncoder().encode(text))
const frame = (body: number[]) => new Uint8Array([PROTOCOL_VERSION & 0xff, PROTOCOL_VERSION >> 8, ...body])

const initMessage = (actorId: string, connectionId: string) =>
	frame([0, ...bareString(actorId), ...bareString(connectionId)])
const actionResponse = (id: number, output: unknown) => frame([2, ...uvarint(id), ...bareData(encodeCbor(output))])
// Event args are the listener's arguments: one payload object.
const eventMessage = (name: string, payload: unknown) =>
	frame([3, ...bareString(name), ...bareData(encodeCbor([payload]))])

class Cursor {
	offset = 2
	constructor(readonly bytes: Uint8Array) {}
	u8() {
		return this.bytes[this.offset++]!
	}
	uvarint() {
		let value = 0
		let scale = 1
		for (;;) {
			const byte = this.u8()
			value += (byte & 0x7f) * scale
			if (byte < 0x80) return value
			scale *= 0x80
		}
	}
	string() {
		const length = this.uvarint()
		const text = new TextDecoder().decode(this.bytes.subarray(this.offset, this.offset + length))
		this.offset += length
		return text
	}
}

/** `ActionRequest` frames from the client (subscriptions need no answer: every event is sent). */
const readActionRequest = (bytes: Uint8Array): { id: number; name: string } | null => {
	const cursor = new Cursor(bytes)
	if (cursor.u8() !== 0) return null
	return { id: cursor.uvarint(), name: cursor.string() }
}

// MARK: HTTP + WebSocket

/** Actor ids carry the dataset, since the WebSocket upgrade bypasses the capture's request headers. */
const actorIdOf = (datasetName: string, messageId: string) => `parity.${datasetName}.${messageId}`
const parseActorId = (actorId: string): RivetSocketData | null => {
	const match = actorId.match(/^parity\.([\w-]+)\.([\w-]+)$/)
	return match ? { datasetName: match[1]!, messageId: match[2]! } : null
}

const json = (request: Request, body: unknown, status = 200) =>
	Response.json(body, { status, headers: { ...corsHeaders(request), "cache-control": "no-store" } })

export const handleRivet = async (
	request: Request,
	url: URL,
	dataset: Dataset,
	upgrade: (data: RivetSocketData) => boolean,
): Promise<Response | undefined> => {
	const path = url.pathname.slice(RIVET_PREFIX.length - 1)
	if (path === "/metadata") return json(request, { runtime: "rivetkit", version: "2.1.6", actorNames: {} })
	if (path === "/actors" && request.method === "PUT") {
		const body: { name: string; key: string } = await request.json()
		return json(request, {
			actor: {
				actor_id: actorIdOf(dataset.name, body.key),
				name: body.name,
				key: body.key,
				namespace_id: "parity",
				runner_name_selector: "default",
				create_ts: dataset.now.getTime(),
				connectable_ts: dataset.now.getTime(),
				start_ts: dataset.now.getTime(),
			},
			created: false,
		})
	}
	const gateway = path.match(/^\/gateway\/([^/@]+)(?:@[^/]*)?\/connect$/)
	if (gateway) {
		const data = parseActorId(decodeURIComponent(gateway[1]!))
		if (data && upgrade(data)) return undefined
		return json(request, { group: "actor", code: "not_found" }, 404)
	}
	return json(request, { group: "parity", code: "not_found" }, 404)
}

export const makeRivetSocketHandlers = (datasets: ReadonlyMap<string, Dataset>) => {
	const scriptOf = (data: RivetSocketData): ActorScript | undefined =>
		datasets.get(data.datasetName)?.actors?.[data.messageId]
	const timers = new WeakMap<ServerWebSocket<RivetSocketData>, Array<ReturnType<typeof setTimeout>>>()
	return {
		open: (socket: ServerWebSocket<RivetSocketData>) => {
			socket.send(initMessage(actorIdOf(socket.data.datasetName, socket.data.messageId), "parity-conn"))
		},
		message: (socket: ServerWebSocket<RivetSocketData>, raw: string | Buffer) => {
			if (typeof raw === "string") return
			const request = readActionRequest(new Uint8Array(raw))
			if (request === null) return
			const script = scriptOf(socket.data)
			socket.send(actionResponse(request.id, request.name === "getState" ? (script?.state ?? null) : null))
			if (request.name !== "getState" || script === undefined) return
			// Events follow the snapshot one by one, like tokens arriving from the model.
			timers.set(
				socket,
				script.events.map((event, index) =>
					setTimeout(() => socket.send(eventMessage(event.name, event.payload)), 20 * (index + 1)),
				),
			)
		},
		close: (socket: ServerWebSocket<RivetSocketData>) => {
			for (const timer of timers.get(socket) ?? []) clearTimeout(timer)
		},
	}
}
