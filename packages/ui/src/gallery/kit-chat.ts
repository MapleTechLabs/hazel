/// <reference path="../../../../apps/web-foldkit/src/vite-env.d.ts" />
import { Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import {
	avatarButton,
	messageRowView,
	type RowContext,
} from "../../../../apps/web-foldkit/src/chat/message/row.ts"
import { MessageRowData } from "../../../../apps/web-foldkit/src/page/chat/rows.ts"

/**
 * The kit side of the chat specimens (lane A5): today's message row (`chat/message/row.ts`) with the
 * content of `fixtures/message/kit.json`. The avatar is the app's: no image, seeded by the author's name.
 */

type H = HtmlBuilder<never>

const unreachable = (): never => {
	throw new Error("the kit's message specimen raises no messages")
}

const row = {
	_tag: "MessageRow" as const,
	...Schema.decodeUnknownSync(MessageRowData)({
		key: "kit-message",
		message: {
			id: "00000000-0000-4000-8000-000000000001",
			channelId: "00000000-0000-4000-8000-000000000002",
			authorId: "00000000-0000-4000-8000-000000000003",
			content: "Shipping the new composer today, notes in the doc.",
			embeds: null,
			hasEmbeds: false,
			replyToMessageId: null,
			threadChannelId: null,
			// 14:05 in the page's own time zone, as `formatTime` reads it.
			createdAtMs: new Date(2026, 10, 26, 14, 5).getTime(),
			updatedAtMs: null,
			isPinned: false,
			author: null,
		},
		groupPosition: "standalone",
		reactions: [],
		author: { displayName: "Ada Lovelace", avatarUrl: null, isBot: false, syncProvider: null },
		hasAuthor: true,
		status: null,
		syncedFrom: null,
		agentName: null,
		authorSide: null,
		reply: null,
		thread: null,
		attachments: [],
		refs: { mentions: [], emojis: [] },
		urlEmbeds: [],
		live: null,
		htmlRenders: [],
		isEntering: false,
		isFirstNew: false,
	}),
}

const context = (h: H): RowContext<never> => ({
	tooltip: {
		active: null,
		hoveredKey: null,
		toMessage: unreachable,
		userName: () => null,
		currentUserId: null,
	},
	toOpenImage: unreachable,
	toOpenEmbedImage: unreachable,
	toOpenThread: unreachable,
	reply: () => ({
		toAuthor: (toTrigger) => toTrigger([]),
		get onJump() {
			return unreachable()
		},
	}),
	toReact: unreachable,
	contextMenu: (_row, render) => render([], h.empty),
	avatar: (message) => avatarButton(h, message, []),
	mention: () => (_mention, toTrigger) => toTrigger([]),
	toHtmlRenderMessage: unreachable,
	toPressEmbedAction: unreachable,
})

/** One frame per specimen, as wide as the fixture gallery's `screen` frame. */
export const chatSpecimens = (h: H): Html =>
	h.div(
		[h.Class("frames"), h.Attribute("style", "flex-direction: column; align-items: stretch;")],
		[
			h.div(
				[h.Attribute("style", "max-width: 720px;")],
				[
					h.div(
						[h.Attribute("data-specimen", "message-default")],
						[messageRowView(h, row, context(h))],
					),
				],
			),
		],
	)
