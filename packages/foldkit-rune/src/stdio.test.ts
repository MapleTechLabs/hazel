import { spawn } from "node:child_process"
import { describe, expect, it } from "vitest"

import { makeLineReader, parseHostLine } from "./stdio"
import type { HostToRuntime } from "./wire"

describe("host line reader", () => {
	it("skips a malformed line and keeps delivering the ones after it", () => {
		const messages: Array<HostToRuntime> = []
		const bad: Array<string> = []
		const read = makeLineReader(
			(m) => messages.push(m),
			(reason) => bad.push(reason),
		)
		read('{"t":"env","width":1,"height":2,"dark":false}\n{not json\n{"t":"scro')
		read('lled","path":"r","top":3}\n["an array"]\n')
		expect(messages).toEqual([
			{ t: "env", width: 1, height: 2, dark: false },
			{ t: "scrolled", path: "r", top: 3 },
		])
		expect(bad).toHaveLength(2)
	})

	it("passes a modal overlay's dismissal on", () => {
		expect(parseHostLine('{"t":"dismiss","path":"r/1/0"}')).toEqual({
			message: { t: "dismiss", path: "r/1/0" },
		})
	})

	it("passes on a link the system opened and a keychain answer", () => {
		expect(parseHostLine('{"t":"openUrl","url":"com.hazel.native://auth/callback?x=1"}')).toEqual({
			message: { t: "openUrl", url: "com.hazel.native://auth/callback?x=1" },
		})
		expect(parseHostLine('{"t":"vault","id":3,"record":null}')).toEqual({
			message: { t: "vault", id: 3, record: null },
		})
	})

	it("rejects JSON that is not a host message", () => {
		expect(parseHostLine('{"t":"tree"}')).toEqual({ error: "not a host message" })
		expect(parseHostLine("null")).toEqual({ error: "not a host message" })
	})

	it("delivers the last message in full when the host closes stdin right after", async () => {
		const stdio = new URL("./stdio.ts", import.meta.url).pathname
		const script = `import { stdioTransport } from ${JSON.stringify(stdio)}
const t = stdioTransport(() => t.send({ t: "scroll", path: "x".repeat(4_000_000), top: 0 }))`
		const child = spawn("bun", ["-e", script], { stdio: ["pipe", "pipe", "inherit"] })
		const chunks: Array<Buffer> = []
		child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
		const exited = new Promise<number | null>((done) => child.on("close", done))
		child.stdin.end('{"t":"env","width":1,"height":1,"dark":false}\n')
		expect(await exited).toBe(0)
		const line = Buffer.concat(chunks).toString("utf8")
		expect(line.length).toBe(
			JSON.stringify({ t: "scroll", path: "x".repeat(4_000_000), top: 0 }).length + 1,
		)
	}, 20_000)
})
