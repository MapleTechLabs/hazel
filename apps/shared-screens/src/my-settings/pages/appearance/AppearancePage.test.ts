// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import type { Theme } from "@hazel/domain/models"
import { describe, expect, test } from "vitest"
import { SetTheme, type ThemePreference } from "../../../app/requests"
import { button, byProp } from "../../../modals/test-support"
import { AppearanceMessage, AppearancePageNoDeps, GenerateRemix } from "./AppearancePage"

/** Appearance: every pick goes to the app as the whole theme, which applies and stores it. */

const theme: ThemePreference = {
	mode: "system",
	customization: { primary: "#6938EF" as Theme.HexColor, grayPalette: "gray-neutral", radius: "normal" },
}
const start = (preference: ThemePreference = theme) =>
	Scene.start(AppearancePageNoDeps, { theme: preference })
/** A `ThemePreview` extension by its kind (its props travel as `args`). */
const preview = (kind: string): Locator.Locator => ({
	description: `<hz:ext ThemePreview ${kind}>`,
	all: (root) =>
		Locator.all(root, Locator.tag("hz:ext")).filter(
			(node) => (node.props?.["args"] as { readonly kind?: string } | undefined)?.kind === kind,
		),
})

describe("appearance page", () => {
	test("a preset sets primary, gray and radius, keeping the mode", () => {
		start()
			.fire(preview("presets"), "select", { value: "ocean" })
			.expectExact(
				SetTheme.make({
					preference: {
						mode: "system",
						customization: {
							primary: "#0EA5E9" as Theme.HexColor,
							grayPalette: "gray-cool",
							radius: "round",
						},
					},
				}),
			)
			.resolve(SetTheme, Component.noop)
	})

	test("brand colour, gray palette, radius and mode each change one field", () => {
		start()
			.fire(byProp("choiceGroup", "label", "Brand color"), "change", { selected: ["#099250"] })
			.expectExact(
				SetTheme.make({
					preference: {
						...theme,
						customization: { ...theme.customization, primary: "#099250" as Theme.HexColor },
					},
				}),
			)
			.resolve(SetTheme, Component.noop)
			.fire(byProp("select", "label", "Gray palette"), "change", { value: "gray-warm" })
			.expectExact(
				SetTheme.make({
					preference: {
						...theme,
						customization: { ...theme.customization, grayPalette: "gray-warm" },
					},
				}),
			)
			.resolve(SetTheme, Component.noop)
			.fire(preview("radius"), "select", { value: "full" })
			.expectExact(
				SetTheme.make({
					preference: { ...theme, customization: { ...theme.customization, radius: "full" } },
				}),
			)
			.resolve(SetTheme, Component.noop)
			.fire(byProp("choiceGroup", "label", "Display preference"), "change", { selected: ["dark"] })
			.expectExact(SetTheme.make({ preference: { ...theme, mode: "dark" } }))
			.resolve(SetTheme, Component.noop)
	})

	test("the current preset is picked; a custom theme picks none", () => {
		const s = start()
		expect(s.get(preview("presets")).props?.["args"]).toMatchObject({
			kind: "presets",
			selected: "default",
		})
		const custom = start({ ...theme, customization: { ...theme.customization, radius: "full" } })
		expect(custom.get(preview("presets")).props?.["args"]).toMatchObject({ selected: null })
	})

	test("generate shows the themes to apply", () => {
		const options = [
			{
				primary: "#E11D48" as Theme.HexColor,
				grayPalette: "gray-warm" as const,
				radius: "full" as const,
			},
		]
		start()
			.fire(button("Generate"), "press")
			.expectExact(GenerateRemix.make({}))
			.resolve(GenerateRemix, AppearanceMessage.GeneratedRemixOptions({ options }))
			.fire(preview("remix"), "select", { value: "0" })
			.expectExact(SetTheme.make({ preference: { mode: "system", customization: options[0]! } }))
			.resolve(SetTheme, Component.noop)
	})
})
