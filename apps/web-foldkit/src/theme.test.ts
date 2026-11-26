// @vitest-environment jsdom
import { Effect, Schema } from "effect"
import { beforeEach, describe, expect, test } from "vitest"
import {
	defaultCustomization,
	defaultThemePreference,
	loadThemePreference,
	saveThemePreference,
	ThemeCustomization,
} from "./theme"

/** The legacy theme storage keys; the shell applies the theme (`root/theme.test.ts`). */

const ocean = Schema.decodeSync(ThemeCustomization)({
	primary: "#0EA5E9",
	grayPalette: "gray-cool",
	radius: "round",
})
const load = () => Effect.runPromise(loadThemePreference)

describe("stored theme preference", () => {
	beforeEach(() => localStorage.clear())

	test("defaults to system with the default preset", async () => {
		expect(await load()).toEqual(defaultThemePreference())
	})

	test("reads the legacy atoms' keys", async () => {
		localStorage.setItem("hazel-ui-theme", JSON.stringify("dark"))
		localStorage.setItem("hazel-theme-customization", JSON.stringify(ocean))
		expect(await load()).toEqual({ mode: "dark", customization: ocean })
	})

	test("a null customization falls back to the legacy brand color", async () => {
		localStorage.setItem("hazel-theme-customization", "null")
		localStorage.setItem("brand-color", JSON.stringify("#099250"))
		expect((await load()).customization).toEqual({ ...defaultCustomization(), primary: "#099250" })
	})

	test("saving round-trips through the same keys", async () => {
		await Effect.runPromise(saveThemePreference({ mode: "light", customization: ocean }))
		expect(localStorage.getItem("hazel-ui-theme")).toBe(JSON.stringify("light"))
		expect(await load()).toEqual({ mode: "light", customization: ocean })
	})
})
