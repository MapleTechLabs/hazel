// @vitest-environment jsdom
import { Effect, Option, Schema } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { fromString } from "foldkit/url"
import { beforeEach, describe, expect, test } from "vitest"
import { ApplyTheme, SaveThemePreference } from "./app/command"
import { sharedOf } from "./app/model"
import { init, Message, requestTheme, update } from "./main"
import {
	defaultCustomization,
	defaultThemePreference,
	loadThemePreference,
	saveThemePreference,
	ThemeCustomization,
} from "./theme"

/** The root owns the theme: the legacy storage keys, `resolvedThemeAtom`, and `RequestedTheme`. */

const ocean = Schema.decodeSync(ThemeCustomization)({ primary: "#0EA5E9", grayPalette: "gray-cool", radius: "round" })
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

const boot = (themePreference = defaultThemePreference()) =>
	Option.match(fromString("http://localhost/sign-in"), {
		onNone: () => expect.unreachable("url"),
		onSome: (url) => init({ themePreference, systemTheme: "light" }, url),
	})

describe("root theme", () => {
	test("boot applies the stored preference before anything else", () => {
		const booted = boot({ mode: "dark", customization: ocean })
		expect(booted.commands?.[0]?.name).toBe(ApplyTheme.name)
		expect(sharedOf(booted.model).theme).toEqual({ mode: "dark", customization: ocean, resolved: "dark" })
	})

	test("a system change re-applies only while the mode follows the system", () => {
		story(
			update,
			given(boot().model),
			message(Message.ChangedSystemTheme({ theme: "dark" })),
			Command.expectExact(ApplyTheme({ resolved: "dark", customization: defaultCustomization() })),
			Command.resolve(ApplyTheme, Message.CompletedApplyTheme()),
			model((current) => expect(sharedOf(current).theme.resolved).toBe("dark")),
		)
		story(
			update,
			given(boot({ mode: "light", customization: ocean }).model),
			message(Message.ChangedSystemTheme({ theme: "dark" })),
			Command.expectNone(),
			model((current) => expect(sharedOf(current).theme.resolved).toBe("light")),
		)
	})

	test("RequestedTheme applies, persists and shares the choice", () => {
		const preference = { mode: "dark" as const, customization: ocean }
		const result = requestTheme(boot().model, preference)
		expect(result.commands?.map(({ name, args }) => ({ name, args }))).toEqual([
			{ name: ApplyTheme.name, args: { resolved: "dark", customization: ocean } },
			{ name: SaveThemePreference.name, args: { preference } },
		])
		expect(sharedOf(result.model).theme).toEqual({ ...preference, resolved: "dark" })
	})

	test("re-requesting the same theme only persists it", () => {
		const result = requestTheme(boot().model, defaultThemePreference())
		expect(result.commands?.map((command) => command.name)).toEqual([SaveThemePreference.name])
	})
})
