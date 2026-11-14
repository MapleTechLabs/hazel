import { describe, expect, it } from "vitest"

import { readConfig } from "./config"
import { isAppPath, makePushDevice, type PushCall } from "./push"

const token = "0a1b2c3d4e5f60718293a4b5c6d7e8f9"
const other = "ffeeddccbbaa99887766554433221100"
const live = { HAZEL_DATA: "live", HAZEL_SESSION_TOKEN: "t", HAZEL_APNS_ENV: "production" }

const makeDevice = (env: Record<string, string>, answer: (call: PushCall) => Promise<boolean>) => {
	const lines: Array<string> = []
	const calls: Array<PushCall> = []
	const device = makePushDevice({
		config: readConfig(env),
		log: (line) => lines.push(line),
		send: (call) => {
			calls.push(call)
			return answer(call)
		},
	})
	return { device, lines, calls }
}

const signedIn = () => Promise.resolve(true)

describe("push device", () => {
	it("registers nothing offline, and logs only the token's start", async () => {
		const { device, lines, calls } = makeDevice({ HAZEL_APNS_ENV: "development" }, signedIn)
		await device.register({ pushToken: token, bundleId: "sh.hazel.ios" })
		expect(lines).toEqual(["[push] offline: not registering 0a1b2c3d…"])
		expect(calls).toEqual([])
	})

	it("registers nothing for a build that names no APNs environment", async () => {
		const { device, lines } = makeDevice({ HAZEL_DATA: "live", HAZEL_SESSION_TOKEN: "t" }, signedIn)
		await device.register({ pushToken: token, bundleId: "hazel.app" })
		expect(lines).toEqual(["[push] this build names no APNs environment: not registering"])
	})

	it("registers a token once, and again when it changes", async () => {
		const { device, calls } = makeDevice(live, signedIn)
		await device.register({ pushToken: token, bundleId: "hazel.app" })
		await device.register({ pushToken: token, bundleId: "hazel.app" })
		await device.register({ pushToken: other, bundleId: "hazel.app" })
		expect(calls.map((call) => call.payload.token)).toEqual([token, other])
		expect(calls[0]).toEqual({
			rpc: "pushDevice.register",
			payload: { token, environment: "production", bundleId: "hazel.app" },
		})
	})

	it("signing out waits for the registration on its way, then forgets the token", async () => {
		let finish: (signedIn: boolean) => void = () => {}
		const { device, calls } = makeDevice(live, (call) =>
			call.rpc === "pushDevice.register"
				? new Promise((resolve) => (finish = resolve))
				: Promise.resolve(true),
		)
		void device.register({ pushToken: token, bundleId: "hazel.app" })
		const signedOut = device.unregister()
		await Promise.resolve()
		expect(calls.map((call) => call.rpc)).toEqual(["pushDevice.register"])
		finish(true)
		await signedOut
		expect(calls.map((call) => call.rpc)).toEqual(["pushDevice.register", "pushDevice.unregister"])
	})

	it("signing out forgets the host's token even when its registration failed", async () => {
		const { device, calls, lines } = makeDevice(live, (call) =>
			call.rpc === "pushDevice.register" ? Promise.reject(new Error("offline")) : Promise.resolve(true),
		)
		await device.register({ pushToken: token, bundleId: "hazel.app" })
		await device.unregister()
		expect(lines[0]).toBe("[push] register failed: Error: offline")
		expect(calls.at(-1)).toEqual({ rpc: "pushDevice.unregister", payload: { token } })
	})

	it("has nothing to forget before the host sent a token", async () => {
		const { device, calls } = makeDevice(live, signedIn)
		await device.unregister()
		expect(calls).toEqual([])
	})

	it("reads the build's APNs environment, and nothing else", () => {
		expect(readConfig({ HAZEL_APNS_ENV: "production" }).apnsEnvironment).toBe("production")
		expect(readConfig({ HAZEL_APNS_ENV: "staging" }).apnsEnvironment).toBeUndefined()
	})
})

describe("a notification's path", () => {
	const base = "https://app.hazel.sh/hazel/chat/c"

	it("opens the app's own paths", () => {
		expect(isAppPath("/hazel/chat/00000005-0000-4000-8000-000000000002", base)).toBe(true)
		expect(isAppPath("/hazel/chat/c?thread=1#m", base)).toBe(true)
	})

	it("never leaves the app", () => {
		for (const path of [
			"//evil.com/x",
			"/\\evil.com/x",
			"https://evil.com/x",
			"evil.com",
			"/\t/evil.com",
		])
			expect(isAppPath(path, base), path).toBe(false)
	})
})
