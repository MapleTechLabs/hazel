import { describe, expect, it } from "vitest"
import { shareOriginOf } from "./share-origin"

const at = (url: string) => {
	const { protocol, hostname, origin } = new URL(url)
	return { protocol, hostname, origin }
}

describe("shareOriginOf", () => {
	it("keeps the page's own origin on the web", () => {
		expect(shareOriginOf(at("https://app.hazel.sh/maple/chat"))).toBe("https://app.hazel.sh")
		expect(shareOriginOf(at("http://localhost:3100/maple"))).toBe("http://localhost:3100")
	})

	it("uses the web app's origin in the desktop and iOS bundles", () => {
		expect(shareOriginOf(at("http://tauri.localhost/maple"))).toBe("https://app.hazel.sh")
		expect(shareOriginOf(at("https://tauri.localhost/maple"))).toBe("https://app.hazel.sh")
		expect(shareOriginOf(at("tauri://localhost/maple"))).toBe("https://app.hazel.sh")
		expect(shareOriginOf(at("hazel://app/maple"))).toBe("https://app.hazel.sh")
	})
})
