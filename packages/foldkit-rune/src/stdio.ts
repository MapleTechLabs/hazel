import type { HostToRuntime, RuntimeToHost } from "./wire"

/** Every host message's tag, keyed by the wire type: a new kind of message cannot be left out. */
const HOST_MESSAGE_TAGS = {
	event: true,
	env: true,
	layout: true,
	scrolled: true,
	dismiss: true,
	pointer: true,
	contextmenu: true,
	key: true,
	files: true,
	paste: true,
	radio: true,
	label: true,
	openUrl: true,
	frame: true,
	vault: true,
	update: true,
	updateProgress: true,
	notifyPermission: true,
	windowFocus: true,
} satisfies Record<HostToRuntime["t"], true>
const HOST_TAGS = new Set<string>(Object.keys(HOST_MESSAGE_TAGS))

const isHostMessage = (value: unknown): value is HostToRuntime =>
	typeof value === "object" &&
	value !== null &&
	"t" in value &&
	typeof value.t === "string" &&
	HOST_TAGS.has(value.t)

/** One line from the host as a message, or the reason it is not one. */
export const parseHostLine = (line: string): { message: HostToRuntime } | { error: string } => {
	// `JSON.parse`, not a Schema decode: the host sends a line per observed row each frame of a
	// scroll, and a decoder of `Unknown` checks nothing JSON.parse does not.
	let value: unknown
	try {
		value = JSON.parse(line)
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) }
	}
	return isHostMessage(value) ? { message: value } : { error: "not a host message" }
}

/** Splits a stream into lines; a malformed one is reported and skipped, never fatal. */
export const makeLineReader = (
	onMessage: (message: HostToRuntime) => void,
	onBadLine: (reason: string) => void,
) => {
	let buffer = ""
	return (chunk: string) => {
		buffer += chunk
		for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
			const line = buffer.slice(0, newline)
			buffer = buffer.slice(newline + 1)
			if (line.trim() === "") continue
			const parsed = parseHostLine(line)
			if ("message" in parsed) onMessage(parsed.message)
			else onBadLine(`${parsed.error}: ${line.slice(0, 200)}`)
		}
	}
}

/** JSON lines over stdin/stdout: the native host spawns the runtime as a child process. */
export const stdioTransport = (onMessage: (message: HostToRuntime) => void) => {
	process.stdin.setEncoding("utf8")
	process.stdin.on(
		"data",
		makeLineReader(onMessage, (reason) => process.stderr.write(`[rune] skipped host line: ${reason}\n`)),
	)
	// Writes the pipe has not taken yet: exiting before they flush would cut off the last tree.
	let pending = 0
	let ended = false
	const exitWhenFlushed = () => {
		if (ended && pending === 0) process.exit(0)
	}
	process.stdin.on("end", () => {
		ended = true
		exitWhenFlushed()
	})
	return {
		/** Answers the line's length, so a caller counting bytes need not serialize it again. */
		send: (message: RuntimeToHost): number => {
			pending += 1
			const line = JSON.stringify(message)
			process.stdout.write(`${line}\n`, () => {
				pending -= 1
				exitWhenFlushed()
			})
			return line.length
		},
	}
}
