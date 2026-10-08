// @vitest-environment jsdom
import { Option, Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { sharedDefaults } from "../../test-shared"
import { GenerateRemixOptions } from "./command"
import { Message } from "./message"
import { Customization } from "./model"
import { init, sharedChanged, update } from "./update"

/** Update-loop tests for the Appearance page: presets, gray palette, remix and display mode. */

const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: null,
	member: null,
	nowMs: 0,
	...sharedDefaults,
}
const pageUpdate = (current: Parameters<typeof update>[0], next: Message) => update(current, next, shared)
const initial = () => init(undefined, shared).model

const ocean = Schema.decodeSync(Customization)({
	primary: "#0EA5E9",
	grayPalette: "gray-cool",
	radius: "round",
})

describe("appearance", () => {
	test("a preset asks the root to apply and persist its customization", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.SelectedPreset({ presetId: "ocean" })),
			expectOutMessage(
				PageOutMessage.RequestedTheme({ preference: { mode: "system", customization: ocean } }),
			),
		)
	})

	test("the gray palette Select follows Shared.theme", () => {
		const next = sharedChanged(initial(), {
			...shared,
			theme: { mode: "system", customization: ocean, resolved: "light" },
		}).model
		expect(next.grayPalette.selectedKey).toEqual(Option.some("gray-cool"))
	})

	test("Generate shows the pending state until the options arrive", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.ClickedGenerate()),
			model((current) => expect(current.isGenerating).toBe(true)),
			Command.resolve(GenerateRemixOptions, Message.GeneratedRemixOptions({ options: [ocean] })),
			model((current) => {
				expect(current.isGenerating).toBe(false)
				expect(current.remixOptions).toHaveLength(1)
			}),
		)
	})

	test("the display mode keeps the customization", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.SelectedThemeMode({ mode: "dark" })),
			expectOutMessage(
				PageOutMessage.RequestedTheme({
					preference: { mode: "dark", customization: shared.theme.customization },
				}),
			),
		)
	})
})
