import { describe, expect, it } from "vitest"
import { dataUrlContent } from "../web/worker-origin"

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe("dataUrlContent", () => {
	it("reads a base64 script", () => {
		const content = dataUrlContent(`data:text/javascript;base64,${btoa("postMessage(1)")}`)
		expect(content?.type).toBe("text/javascript")
		expect(text(content?.bytes ?? new Uint8Array())).toBe("postMessage(1)")
	})

	it("reads a percent-encoded script, with parameters on its type", () => {
		const content = dataUrlContent("data:text/javascript;charset=utf-8,let%20a%20%3D%201%2C%202")
		expect(content?.type).toBe("text/javascript")
		expect(text(content?.bytes ?? new Uint8Array())).toBe("let a = 1, 2")
	})

	it("leaves any other URL alone", () => {
		expect(dataUrlContent("https://app.hazel.sh/assets/opfs-worker.js")).toBeUndefined()
		expect(dataUrlContent("blob:https://app.hazel.sh/1234")).toBeUndefined()
	})
})
