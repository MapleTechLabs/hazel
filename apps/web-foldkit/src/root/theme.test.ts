// @vitest-environment jsdom
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../page/out-message"
import { callsOf, namesOf, shellBoot, shellBootReturn } from "../test/root-fixtures"
import {
	defaultCustomization,
	defaultThemePreference,
	ThemeCustomization,
	type ThemePreference,
} from "../theme"
import { hostContextOf, update } from "./logic"
import { AppMessage } from "./message"

/** The shell owns the theme: it applies it at boot, follows the system, and persists a choice. */

const ocean = Schema.decodeSync(ThemeCustomization)({
	primary: "#0EA5E9",
	grayPalette: "gray-cool",
	radius: "round",
})

const boot = (themePreference: ThemePreference = defaultThemePreference()) =>
	shellBootReturn("/sign-in", { themePreference })

/** A page or the palette asked for `preference` (through the Foldkit host). */
const requestTheme = (preference: ThemePreference) =>
	update(
		shellBoot("/sign-in"),
		AppMessage.ReceivedHostOut({
			out: { _tag: "Page", outMessage: PageOutMessage.RequestedTheme({ preference }) },
		}),
	)

describe("root theme", () => {
	test("boot applies the stored preference before anything else", () => {
		const booted = boot({ mode: "dark", customization: ocean })
		expect(callsOf(booted.commands)[0]).toEqual({
			name: "ApplyTheme",
			args: { resolved: "dark", customization: ocean },
		})
		const context = hostContextOf(booted.model)
		expect({ ...context.themePreference, resolved: context.resolvedTheme }).toEqual({
			mode: "dark",
			customization: ocean,
			resolved: "dark",
		})
	})

	test("a system change re-applies only while the mode follows the system", () => {
		const following = update(boot().model, AppMessage.ChangedSystemTheme({ theme: "dark" }))
		expect(callsOf(following.commands)).toEqual([
			{ name: "ApplyTheme", args: { resolved: "dark", customization: defaultCustomization() } },
		])
		expect(hostContextOf(following.model).resolvedTheme).toBe("dark")

		const fixed = update(
			boot({ mode: "light", customization: ocean }).model,
			AppMessage.ChangedSystemTheme({ theme: "dark" }),
		)
		expect(fixed.commands).toEqual([])
		expect(hostContextOf(fixed.model).resolvedTheme).toBe("light")
	})

	test("RequestedTheme applies, persists and shares the choice", () => {
		const preference = { mode: "dark" as const, customization: ocean }
		const result = requestTheme(preference)
		expect(callsOf(result.commands)).toEqual([
			{ name: "ApplyTheme", args: { resolved: "dark", customization: ocean } },
			{ name: "SaveThemePreference", args: { preference } },
		])
		const context = hostContextOf(result.model)
		expect({ ...context.themePreference, resolved: context.resolvedTheme }).toEqual({
			...preference,
			resolved: "dark",
		})
	})

	test("re-requesting the same theme only persists it", () => {
		expect(namesOf(requestTheme(defaultThemePreference()).commands)).toEqual(["SaveThemePreference"])
	})
})
