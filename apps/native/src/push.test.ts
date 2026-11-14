import { describe, expect, it } from "vitest"

import { readConfig } from "./config"
import { makePushDevice } from "./push"

const token = "0a1b2c3d4e5f60718293a4b5c6d7e8f9"

const makeDevice = (env: Record<string, string>) => {
	const lines: Array<string> = []
	const device = makePushDevice({ config: readConfig(env), log: (line) => lines.push(line) })
	return { device, lines }
}

describe("push device", () => {
	it("registers nothing offline, and logs only the token's start", async () => {
		const { device, lines } = makeDevice({ HAZEL_APNS_ENV: "development" })
		await device.register({ pushToken: token, bundleId: "sh.hazel.ios" })
		expect(lines).toEqual(["[push] offline: not registering 0a1b2c3d…"])
	})

	it("registers nothing for a build that names no APNs environment", async () => {
		const { device, lines } = makeDevice({ HAZEL_DATA: "live", HAZEL_SESSION_TOKEN: "t" })
		await device.register({ pushToken: token, bundleId: "hazel.app" })
		expect(lines).toEqual(["[push] this build names no APNs environment: not registering"])
	})

	it("has nothing to forget before a token was registered", async () => {
		const { device, lines } = makeDevice({ HAZEL_DATA: "live", HAZEL_APNS_ENV: "production" })
		await device.unregister()
		expect(lines).toEqual([])
	})

	it("reads the build's APNs environment, and nothing else", () => {
		expect(readConfig({ HAZEL_APNS_ENV: "production" }).apnsEnvironment).toBe("production")
		expect(readConfig({ HAZEL_APNS_ENV: "staging" }).apnsEnvironment).toBeUndefined()
	})
})
