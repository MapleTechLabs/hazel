import { describe, expect, test } from "vitest"
import webConfig, { wellKnownDiscovery } from "../../../vite.config"
import { DISCOVERY_PATH, discoveryAsset, discoveryJson, serverFromEnv } from "./discovery"
import { parseServer } from "./server"

const customerEnv = {
	VITE_APP_URL: "https://app.chat.acme.com",
	VITE_BACKEND_URL: "https://api.chat.acme.com/",
	VITE_R2_PUBLIC_URL: "https://cdn.chat.acme.com",
	VITE_LINK_PREVIEW_URL: "https://link-preview.chat.acme.com",
}

describe("the discovery document", () => {
	test("names the install the build was made for", () => {
		expect(JSON.parse(discoveryJson(serverFromEnv(customerEnv)))).toEqual({
			app: "https://app.chat.acme.com",
			api: "https://api.chat.acme.com",
			cdn: "https://cdn.chat.acme.com",
			linkPreview: "https://link-preview.chat.acme.com",
		})
	})

	test("unset inputs fall back to Hazel's web app and no uploads or preview worker", () => {
		expect(JSON.parse(discoveryJson(serverFromEnv({})))).toEqual({
			app: "https://app.hazel.sh",
			api: "http://localhost:3003",
			cdn: null,
			linkPreview: null,
		})
	})

	test("what the build writes, the native apps read back", () => {
		expect(parseServer(JSON.parse(discoveryJson(serverFromEnv(customerEnv))))).toEqual(
			serverFromEnv(customerEnv),
		)
	})

	test("the build emits it at /.well-known/hazel.json", () => {
		expect(discoveryAsset(customerEnv)).toEqual({
			type: "asset",
			fileName: ".well-known/hazel.json",
			source: discoveryJson(serverFromEnv(customerEnv)),
		})
		expect(`/${discoveryAsset({}).fileName}`).toBe(DISCOVERY_PATH)
	})

	test("the web build writes it", () => {
		const names = (webConfig.plugins ?? [])
			.flat()
			.map((plugin) =>
				plugin !== null && typeof plugin === "object" && "name" in plugin ? plugin.name : null,
			)
		expect(names).toContain(wellKnownDiscovery().name)
	})
})
