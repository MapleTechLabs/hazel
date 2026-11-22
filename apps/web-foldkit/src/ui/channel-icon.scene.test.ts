// @vitest-environment jsdom
import type { OrganizationId } from "@hazel/schema"
import type { HtmlBuilder } from "foldkit/html"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { type ChannelIconProps, channelIcon, NO_CHANNEL_LINKS } from "./channel-icon"

/** `channelIcon`: which glyph a channel gets, and which marks its links add. */

type Model = ChannelIconProps
type Message = never

const update = (model: Model): readonly [Model, ReadonlyArray<never>] => [model, []]
const view = (model: Model, h: HtmlBuilder<Message>) => h.div([], [channelIcon(h, model)])

const icon = Scene.selector("[data-channel-icon]")
const inIcon = (selector: string) => Scene.within(icon, Scene.selector(selector))
const titled = (title: string) => inIcon(`[title="${title}"]`)

const acme = { name: "Acme Corp", logoUrl: null }
const northwind = {
	id: "7c1e0b8f-3a52-4f8e-9a51-6f1c2d3e4a5b" as OrganizationId,
	name: "Northwind",
	logoUrl: null,
}

const scene = (model: Model, ...steps: ReadonlyArray<Parameters<typeof Scene.scene>[2]>) =>
	Scene.scene({ update, view }, Scene.given(model), ...steps)

describe("channel icon", () => {
	test("an emoji wins over the hashtag, with no marks", () => {
		scene(
			{ icon: "🚀" },
			Scene.expect(icon).toHaveText("🚀"),
			Scene.expect(inIcon("svg")).toBeAbsent(),
			Scene.expect(inIcon("[title]")).toBeAbsent(),
		)
	})

	test("a private channel without an emoji draws a lock, not a hashtag, and no lock mark", () => {
		scene(
			{ icon: null, isPrivate: true, links: NO_CHANNEL_LINKS },
			Scene.expect(inIcon("svg")).toExist(),
			Scene.expect(titled("Private channel")).toBeAbsent(),
		)
	})

	test("a customer's initial replaces the emoji, and a private one gets the lock mark", () => {
		scene(
			{ icon: "🚀", isPrivate: true, links: { ...NO_CHANNEL_LINKS, customer: acme } },
			Scene.expect(icon).not.toHaveText("🚀"),
			Scene.expect(icon).toHaveText("A"),
			Scene.expect(titled("Private channel")).toExist(),
		)
	})

	test("Connect partners and the sync platform are marked together", () => {
		scene(
			{ icon: null, links: { customer: null, partners: [northwind], syncProvider: "slack" } },
			Scene.expect(titled("Shared with Northwind")).toExist(),
			Scene.expect(titled("Synced with Slack")).toExist(),
		)
	})

	test("Discord is named as Discord", () => {
		scene(
			{ icon: null, links: { ...NO_CHANNEL_LINKS, syncProvider: "discord" } },
			Scene.expect(titled("Synced with Discord")).toExist(),
			Scene.expect(titled("Synced with Slack")).toBeAbsent(),
		)
	})
})
