import { describe, expect, it } from "vitest"

import { describeLink, makeDesktopBridge } from "./desktop-bridge"

const makeBridge = () => {
	const sent: Array<unknown> = []
	const opened: Array<string> = []
	const bridge = makeDesktopBridge({
		send: (request) => sent.push(request),
		openUrl: (url) => opened.push(url),
	})
	return { bridge, sent, opened }
}

describe("the native desktop bridge", () => {
	it("reads and writes the vault through the host", async () => {
		const { bridge, sent } = makeBridge()
		const written = bridge.tauri.core.invoke("auth_vault_write", { record: "{}" })
		const read = bridge.tauri.core.invoke("auth_vault_read")
		expect(sent).toEqual([
			{ t: "vault", id: 1, op: "write", record: "{}" },
			{ t: "vault", id: 2, op: "read" },
		])
		bridge.answer({ t: "vault", id: 2, record: "{}" })
		bridge.answer({ t: "vault", id: 1, record: null })
		expect(await read).toBe("{}")
		expect(await written).toBeNull()
	})

	it("fails a vault call the keychain refused, and any other command", async () => {
		const { bridge } = makeBridge()
		const read = bridge.tauri.core.invoke("auth_vault_read")
		bridge.answer({ t: "vault", id: 1, error: "denied" })
		await expect(read).rejects.toThrow("denied")
		await expect(bridge.tauri.core.invoke("plugin:updater|check")).rejects.toThrow()
	})

	it("keeps a link that arrives before sign-in listens, then hands the next ones straight on", async () => {
		const { bridge } = makeBridge()
		bridge.openedUrl("com.hazel.native://auth/callback?state=a")
		const heard: Array<ReadonlyArray<string>> = []
		const unlisten = await bridge.tauri.deepLink.onOpenUrl((urls) => heard.push(urls))
		expect(await bridge.tauri.deepLink.getCurrent()).toEqual(["com.hazel.native://auth/callback?state=a"])
		expect(await bridge.tauri.deepLink.getCurrent()).toBeNull()
		bridge.openedUrl("com.hazel.native://auth/callback?state=b")
		unlisten()
		bridge.openedUrl("com.hazel.native://auth/callback?state=c")
		expect(heard).toEqual([["com.hazel.native://auth/callback?state=b"]])
	})

	it("opens the hosted sign-in page in the system browser", async () => {
		const { bridge, opened } = makeBridge()
		await bridge.tauri.opener.openUrl("https://app.hazel.sh/auth/desktop?attempt=x")
		expect(opened).toEqual(["https://app.hazel.sh/auth/desktop?attempt=x"])
	})

	it("logs a link without its query's values", () => {
		expect(describeLink("com.hazel.native://auth/callback?state=s&code=secret")).toBe(
			"com.hazel.native://auth/callback ?state&code",
		)
	})
})
