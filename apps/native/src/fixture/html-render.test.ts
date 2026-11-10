import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HTML_RENDER_CONTENT_SECURITY_POLICY } from "@hazel/domain/html-render"
import { Message } from "@hazel/domain/models"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { makeFixtureServer } from "./fixture-socket"
import { makeFixtureHtmlRender } from "./html-render"
import { makeOfflineFetch } from "../offline-backend"
import { currentUser } from "../offline-session"
import { generalChannelId } from "./snapshot"

describe("makeFixtureHtmlRender", () => {
	it("adds a message showing the page, and serves the page as the api does", async () => {
		const file = join(mkdtempSync(join(tmpdir(), "hazel-fixture-html-")), "page.html")
		writeFileSync(file, "<h1>Chart</h1>")
		const render = await makeFixtureHtmlRender(file)

		// A row the app's own schema accepts, in #general.
		const row = Schema.decodeUnknownSync(Schema.toCodecJson(Message.Schema))(render.message)
		expect(row.channelId).toBe(generalChannelId)
		expect(row.embeds?.[0]?.html?.title).toBe("Fixture render")

		// `message.htmlRenderUrl` answers with the URL, which serves the page sandboxed and bootstrapped.
		const backendUrl = "http://offline.hazel.test"
		const fetchOffline = makeOfflineFetch({
			backendUrl,
			user: currentUser,
			server: makeFixtureServer(),
			htmlRenderUrl: render.url,
		})
		const answer = await fetchOffline(`${backendUrl}/rpc`, {
			method: "POST",
			body: `${JSON.stringify({
				_tag: "Request",
				id: "1",
				tag: "message.htmlRenderUrl",
				payload: {
					channelId: row.channelId,
					messageId: row.id,
					renderId: row.embeds?.[0]?.html?.renderId,
				},
				headers: [],
			})}\n`,
		}).then((response) => response.text())
		const { url } = render.url()
		expect(JSON.parse(answer).exit).toMatchObject({ _tag: "Success", value: { url } })

		const page = await fetch(url)
		expect(page.headers.get("content-security-policy")).toBe(HTML_RENDER_CONTENT_SECURITY_POLICY)
		const html = await page.text()
		expect(html).toContain('<style id="hazel-theme">')
		expect(html).toContain("<h1>Chart</h1>")
		// Read per request: an edit shows on the next load.
		writeFileSync(file, "<h1>Edited</h1>")
		expect(await (await fetch(url)).text()).toContain("<h1>Edited</h1>")
	})
})
