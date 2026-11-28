/**
 * The offline #general's HTML render message (`HAZEL_FIXTURE_HTML`), for a page at a URL: the
 * Bun runtime serves a file itself (`./html-render`); iOS's worker cannot, so there the variable
 * is the URL of a page the Mac serves (`scripts/serve-fixture-html.ts`), which the Simulator reaches.
 */
import { generalChannelId, generalMessageRows } from "./snapshot"

const RENDER_ID = "00000000-0000-4000-8000-0000000f0001"
const MESSAGE_ID = "00000000-0000-4000-8000-0000000f0002"
const HOUR = 3_600_000

/** The message to add, and `message.htmlRenderUrl`'s answer for the page at `url`. */
export const fixtureHtmlRenderAt = (url: string) => ({
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
	url: () => ({ url, expiresAt: Date.now() + HOUR }),
})

/** `HAZEL_FIXTURE_HTML` names a page by URL rather than a file. */
export const isPageUrl = (value: string) => /^https?:\/\//.test(value)
