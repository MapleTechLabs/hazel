import type { HostToRuntime, RuntimeToHost } from "./wire"

/** JSON lines over stdin/stdout: the native host spawns the runtime as a child process. */
export const stdioTransport = (onMessage: (message: HostToRuntime) => void) => {
	let buffer = ""
	process.stdin.setEncoding("utf8")
	process.stdin.on("data", (chunk: string) => {
		buffer += chunk
		for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
			const line = buffer.slice(0, newline)
			buffer = buffer.slice(newline + 1)
			if (line.trim() === "") continue
			// SAFETY: the native host writes only HostToRuntime messages, one JSON object per line.
			onMessage(JSON.parse(line) as HostToRuntime)
		}
	})
	process.stdin.on("end", () => process.exit(0))
	return {
		send: (message: RuntimeToHost) => {
			process.stdout.write(`${JSON.stringify(message)}\n`)
		},
	}
}
