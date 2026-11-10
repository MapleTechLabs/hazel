/**
 * `HAZEL_FIXTURE_HTML=<file.html>`: the offline #general ends with a message showing that page as
 * an HTML render, served from a local port as the api serves one (bootstrap, sandbox CSP), so a
 * page can be tried in the native app without a backend.
 */
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { HTML_RENDER_CONTENT_SECURITY_POLICY, injectHtmlRenderBootstrap } from "@hazel/domain/html-render"
import { generalChannelId, generalMessageRows } from "./snapshot"

const RENDER_ID = "00000000-0000-4000-8000-0000000f0001"
const MESSAGE_ID = "00000000-0000-4000-8000-0000000f0002"
const HOUR = 3_600_000

/** Starts the page server for `file` and answers with the message to add and its `message.htmlRenderUrl`. */
export const makeFixtureHtmlRender = async (file: string) => {
	// Read per request: an edit to the file shows on the next load.
	const server = createServer((_request, response) => {
		let page: string
		try {
			page = injectHtmlRenderBootstrap(readFileSync(file, "utf8"))
		} catch (error) {
			// An editor that saves by renaming leaves no file for a moment: this load fails, as a
			// missing page does on the api, and the next one reads the file again.
			response.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
			response.end(`Could not read the page: ${error instanceof Error ? error.message : String(error)}`)
			return
		}
		response.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
			"content-security-policy": HTML_RENDER_CONTENT_SECURITY_POLICY,
			"x-content-type-options": "nosniff",
			"referrer-policy": "no-referrer",
		})
		response.end(page)
	})
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
	// SAFETY: a TCP server that is listening has an `AddressInfo`.
	const { port } = server.address() as AddressInfo
	// The runtime exits with the app; the server must not keep it alive on its own.
	server.unref()
	return {
		/** A row for the channel's `messages`: the last message's author posts the render. */
		message: {
			...generalMessageRows.at(-1),
			id: MESSAGE_ID,
			channelId: generalChannelId,
			content: "",
			embeds: [{ html: { renderId: RENDER_ID, title: "Fixture render", height: 320 } }],
			replyToMessageId: null,
			createdAt: new Date().toISOString(),
			updatedAt: null,
		},
		/** `message.htmlRenderUrl`'s answer. */
		url: () => ({
			url: `http://127.0.0.1:${port}/html-renders/fixture`,
			expiresAt: Date.now() + HOUR,
		}),
	}
}
