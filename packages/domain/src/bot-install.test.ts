import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
	InstallRedirectUri,
	InstallRedirectUris,
	installRedirectUrl,
	isRegisteredInstallRedirect,
	isValidInstallRedirectUri,
	regionOfInstallRedirect,
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

	it("takes one well-formed region, which names the callback's region of the service", () => {
		expect(isValidInstallRedirectUri("https://api.eu.maple.dev/cb?hazel_region=eu")).toBe(true)
		expect(isValidInstallRedirectUri("https://api.eu.maple.dev/cb?hazel_region=EU")).toBe(false)
		expect(isValidInstallRedirectUri("https://api.eu.maple.dev/cb?hazel_region=")).toBe(false)
		expect(isValidInstallRedirectUri("https://api.eu.maple.dev/cb?hazel_region=eu&hazel_region=us")).toBe(
			false,
		)
		expect(regionOfInstallRedirect("https://api.eu.maple.dev/cb?hazel_region=eu")).toBe("eu")
		expect(regionOfInstallRedirect("https://api.maple.dev/cb")).toBe(null)
		// A bot's own `region` parameter is just part of its URI.
		expect(isValidInstallRedirectUri("https://api.example/cb?region=prod")).toBe(true)
		expect(regionOfInstallRedirect("https://api.example/cb?region=prod")).toBe(null)
	})

	it("says what is wrong with a rejected region", () => {
		const decode = Schema.decodeUnknownExit(InstallRedirectUri)
		expect(String(decode("https://a.example/cb?hazel_region=EU"))).toContain(
			"hazel_region to be lowercase",
		)
		expect(String(decode("https://a.example/cb?hazel_region=eu&hazel_region=us"))).toContain(
			"at most one hazel_region",
		)
		expect(String(decode("http://a.example/cb"))).toContain("Expected an https URL")
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
