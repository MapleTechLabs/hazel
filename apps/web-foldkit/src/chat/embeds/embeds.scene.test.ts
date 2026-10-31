// @vitest-environment jsdom
import type { MessageEmbed } from "@hazel/domain/models"
import { inertHtml as h } from "foldkit/html"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { messageEmbedsView } from "./index"

/** The embeds block of a bot's live reply: a card the reply carries, and its streamed text. */

const embeds: ReadonlyArray<MessageEmbed.MessageEmbed> = [
	{ title: "Approve the change?" },
	{ liveState: { enabled: true } },
]
const config = {
	update: (model: null) => ({ model }),
	view: () => h.main([], [messageEmbedsView(h, embeds, h.p([], ["Checkout is slow because"]))]),
}

describe("message embeds scene", () => {
	test("a live reply's text comes before its cards, as a plain message's content does", () => {
		Scene.scene(
			config,
			Scene.given(null),
			Scene.expect(Scene.role("main")).toHaveText("Checkout is slow becauseApprove the change?"),
		)
	})
})
