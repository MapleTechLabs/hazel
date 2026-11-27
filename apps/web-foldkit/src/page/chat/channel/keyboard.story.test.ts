import { Command, given, message, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import type { ComposerRequest } from "@hazel/shared-screens/chat/composer/host"
import { channelId, loadedModel, updateWithShared } from "./fixtures.test-support"
import { Message } from "./model"
import { ClearChannelNotifications } from "./clear-notifications"
import * as MessageList from "../../../mount/message-list"
import { RequestComposer } from "./write"

/** Channel-level keys: typing anywhere and the composer shortcuts go to the shared composer. */

vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

/** The request the page publishes to the channel's composer, answered. */
const asks = (request: ComposerRequest) =>
	[
		Command.expectExact(RequestComposer({ channelId, request })),
		Command.resolve(RequestComposer, Message.CompletedRequestComposer()),
	] as const

describe("channel keys", () => {
	test("a key typed outside the composer goes into it", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.PressedGlobalKey({ key: "h" })),
			...asks({ _tag: "InsertText", text: "h" }),
		)
	})
})

/** Discord's channel shortcuts (`hotkeys.ts`): each does what its button does. */
describe("channel shortcuts", () => {
	test("Mod+E opens the composer's emoji picker", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.PressedChannelHotkey({ action: "EmojiPicker" })),
			...asks({ _tag: "OpenEmojiPicker" }),
		)
	})

	test("Mod+G opens the GIF picker", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.PressedChannelHotkey({ action: "GifPicker" })),
			...asks({ _tag: "OpenGifPicker" }),
		)
	})

	test("Mod+Shift+U opens the file picker to upload", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.PressedChannelHotkey({ action: "Upload" })),
			...asks({ _tag: "Attach" }),
		)
	})

	test("Mod+P goes to the channel header's pins", () => {
		const pressed = updateWithShared(loadedModel(), Message.PressedChannelHotkey({ action: "Pins" }))
		expect(pressed.commands?.map((command) => command.name)).toEqual(["PublishPinsHotkey"])
	})
})

describe("reading keys", () => {
	test("Escape outside the composer marks the channel read", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.PressedChannelHotkey({ action: "MarkRead" })),
			Command.expectExact(ClearChannelNotifications({ channelId })),
			Command.resolve(ClearChannelNotifications, Message.SucceededClearNotifications({ channelId })),
		)
	})

	test("Escape in the composer with nothing to cancel marks the channel read too", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.ReceivedComposerNotice({ notice: { _tag: "Escaped", channelId } })),
			Command.expectExact(ClearChannelNotifications({ channelId })),
			Command.resolve(ClearChannelNotifications, Message.SucceededClearNotifications({ channelId })),
		)
	})

	test("PageUp and PageDown scroll the messages by most of a viewport", () => {
		const withViewport = (model: ReturnType<typeof loadedModel>) => ({
			...model,
			list: {
				...model.list,
				keys: Array.from({ length: 30 }, (_, index) => `row-${index}`),
				viewportHeight: 400,
				scrollTop: 1000,
				anchor: MessageList.ViewportAnchor.Row({ key: "row-12", viewportOffset: -40 }),
			},
		})
		const up = updateWithShared(
			withViewport(loadedModel()),
			Message.PressedChannelHotkey({ action: "ScrollUp" }),
		)
		expect(up.model.list.scrollTop).toBe(1000 - 336)
		const down = updateWithShared(
			withViewport(loadedModel()),
			Message.PressedChannelHotkey({ action: "ScrollDown" }),
		)
		expect(down.model.list.scrollTop).toBe(1000 + 336)
	})
})
