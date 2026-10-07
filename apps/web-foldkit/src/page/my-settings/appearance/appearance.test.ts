// @vitest-environment jsdom
import { Option, Schema } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { ApplyAppearance, GenerateRemixOptions } from "./command"
import { Message } from "./message"
import { Customization } from "./model"
import { init, update } from "./update"

/** Update-loop tests for the Appearance page: presets, gray palette, remix and display mode. */

const ocean = Schema.decodeSync(Customization)({
	primary: "#0EA5E9",
	grayPalette: "gray-cool",
	radius: "round",
})

describe("appearance", () => {
	test("a preset applies and persists its customization", () => {
		story(
			update,
			given(init().model),
			message(Message.SelectedPreset({ presetId: "ocean" })),
			model((current) => {
				expect(current.customization).toEqual(ocean)
				expect(current.grayPalette.selectedKey).toEqual(Option.some("gray-cool"))
			}),
			Command.expectHas(ApplyAppearance({ mode: "system", customization: ocean, shouldPersist: true })),
			Command.resolveAll([ApplyAppearance, Message.CompletedApplyAppearance()]),
		)
	})

	test("Generate shows the pending state until the options arrive", () => {
		story(
			update,
			given(init().model),
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
			update,
			given(init().model),
			message(Message.SelectedThemeMode({ mode: "dark" })),
			model((current) => expect(current.mode).toBe("dark")),
			Command.resolve(ApplyAppearance, Message.CompletedApplyAppearance()),
		)
	})
})
