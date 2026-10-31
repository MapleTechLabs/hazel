import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
	InstallRedirectUris,
	installRedirectUrl,
	isRegisteredInstallRedirect,
	isValidInstallRedirectUri,
} from "./bot-install"

describe("bot install redirect URIs", () => {
	it("accepts https, and http only on loopback", () => {
		expect(isValidInstallRedirectUri("https://api.maple.dev/oauth/chat/hazel/callback")).toBe(true)
		expect(isValidInstallRedirectUri("http://localhost:3472/callback")).toBe(true)
		expect(isValidInstallRedirectUri("http://127.0.0.1/callback")).toBe(true)
		expect(isValidInstallRedirectUri("http://maple.dev/callback")).toBe(false)
		expect(isValidInstallRedirectUri("javascript:alert(1)")).toBe(false)
		expect(isValidInstallRedirectUri("https://maple.dev/cb#frag")).toBe(false)
		expect(isValidInstallRedirectUri("https://user:pass@maple.dev/cb")).toBe(false)
		expect(isValidInstallRedirectUri("/relative")).toBe(false)
	})

	it("decodes a list of at most ten", () => {
		const decode = Schema.decodeUnknownOption(InstallRedirectUris)
		expect(decode(["https://a.example/cb"])._tag).toBe("Some")
		expect(decode(["http://a.example/cb"])._tag).toBe("None")
		expect(decode(Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`))._tag).toBe("None")
	})

	it("matches registered URIs exactly", () => {
		const registered = ["https://a.example/cb"]
		expect(isRegisteredInstallRedirect(registered, "https://a.example/cb")).toBe(true)
		expect(isRegisteredInstallRedirect(registered, "https://a.example/cb/")).toBe(false)
		expect(isRegisteredInstallRedirect(registered, "https://a.example/cb?x=1")).toBe(false)
		expect(isRegisteredInstallRedirect(null, "https://a.example/cb")).toBe(false)
	})

	it("adds the grant to the redirect's query, keeping what it had", () => {
		expect(installRedirectUrl("https://a.example/cb?tenant=eu", { code: "c", state: "s&t" })).toBe(
			"https://a.example/cb?tenant=eu&code=c&state=s%26t",
		)
	})
})
