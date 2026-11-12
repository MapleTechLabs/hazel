import { describe, expect, it } from "vitest"

import { type DownloadEvent, describeLink, makeDesktopBridge } from "./desktop-bridge"

const makeBridge = (updates = false) => {
	const sent: Array<unknown> = []
	const opened: Array<string> = []
	const bridge = makeDesktopBridge({
		send: (request) => sent.push(request),
		openUrl: (url) => opened.push(url),
		updates,
	})
	return { bridge, sent, opened }
}

/** A promise's next turn: what `.then` chains after an answer have run by then. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("the native desktop bridge", () => {
	it("offers notifications only where the host shows them, and asks it for permission", async () => {
		expect(makeBridge().bridge.tauri.notification).toBeUndefined()
		const sent: Array<unknown> = []
		const bridge = makeDesktopBridge({
			send: (r) => sent.push(r),
			openUrl: () => {},
			notifications: true,
		})
		const notification = bridge.tauri.notification
		if (notification === undefined) throw new Error("no notification API")
		const granted = notification.isPermissionGranted()
		const asked = notification.requestPermission()
		bridge.answer({ t: "notifyPermission", id: 1, granted: false })
		bridge.answer({ t: "notifyPermission", id: 2, granted: true })
		expect(await granted).toBe(false)
		expect(await asked).toBe("granted")
		notification.sendNotification({ title: "Ada in #general", body: "Hi", group: "c1" })
		expect(sent).toEqual([
			{ t: "notifyPermission", id: 1, request: false },
			{ t: "notifyPermission", id: 2, request: true },
			{ t: "notify", title: "Ada in #general", body: "Hi", group: "c1" },
		])
	})

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

	it("offers updates only from a bundle the host can update", () => {
		expect(makeBridge().bridge.tauri.updater).toBeUndefined()
		expect(makeBridge().bridge.tauri.process).toBeUndefined()
		expect(makeBridge(true).bridge.tauri.updater).toBeDefined()
		expect(makeBridge().bridge.tauri.app).toBeUndefined()
	})

	it("checks, downloads with Tauri's progress events, installs and relaunches through the host", async () => {
		const { bridge, sent } = makeBridge(true)
		const { updater, process } = bridge.tauri
		if (updater === undefined || process === undefined) throw new Error("no updater")
		const checked = updater.check()
		bridge.answer({ t: "update", id: 1, version: "1.1.0", notes: "Hazel on Rune" })
		const found = await checked
		if (found === null) throw new Error("no update found")
		expect(found).toMatchObject({ version: "1.1.0", body: "Hazel on Rune" })

		const events: Array<DownloadEvent> = []
		const downloaded = found.download((event) => events.push(event))
		bridge.answer({ t: "updateProgress", id: 2, downloaded: 0, total: 300 })
		bridge.answer({ t: "updateProgress", id: 2, downloaded: 100, total: 300 })
		bridge.answer({ t: "updateProgress", id: 2, downloaded: 300, total: 300 })
		bridge.answer({ t: "update", id: 2 })
		await downloaded
		expect(events).toEqual([
			{ event: "Started", data: { contentLength: 300 } },
			{ event: "Progress", data: { chunkLength: 100 } },
			{ event: "Progress", data: { chunkLength: 200 } },
			{ event: "Finished" },
		])

		const installed = found.install()
		bridge.answer({ t: "update", id: 3 })
		await installed
		// A relaunch that works ends the runtime; one the host could not do rejects, so the app says so.
		const relaunched = process.relaunch()
		bridge.answer({ t: "update", id: 4, error: "cannot relaunch: denied" })
		await expect(relaunched).rejects.toThrow("cannot relaunch")
		expect(sent).toEqual([
			{ t: "update", id: 1, op: "check" },
			{ t: "update", id: 2, op: "download" },
			{ t: "update", id: 3, op: "install" },
			{ t: "relaunch", id: 4 },
		])
	})

	it("finds nothing when the host has no newer release, and fails a step the host could not do", async () => {
		const { bridge } = makeBridge(true)
		const { updater } = bridge.tauri
		if (updater === undefined) throw new Error("no updater")
		const none = updater.check()
		bridge.answer({ t: "update", id: 1 })
		expect(await none).toBeNull()

		const found = updater.check()
		bridge.answer({ t: "update", id: 2, version: "1.1.0" })
		const release = await found
		if (release === null) throw new Error("no update found")
		const download = release.download()
		await settle()
		bridge.answer({ t: "update", id: 3, error: "the update's signature does not verify" })
		await expect(download).rejects.toThrow("signature")
	})

	it("reports the host's version to the app", async () => {
		const bridge = makeDesktopBridge({ send: () => {}, openUrl: () => {}, version: "1.1.0" })
		expect(await bridge.tauri.app?.getVersion()).toBe("1.1.0")
	})

	it("logs a link without its query's values", () => {
		expect(describeLink("com.hazel.native://auth/callback?state=s&code=secret")).toBe(
			"com.hazel.native://auth/callback ?state&code",
		)
	})
})
