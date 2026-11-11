// @vitest-environment jsdom
import { Option } from "effect"
import { fromString } from "foldkit/url"
import { describe, expect, test } from "vitest"
import { init, Message, update } from "../main"
import { DEFAULT_SOUND_SETTINGS } from "../notification-sound"
import { defaultThemePreference } from "../theme"
import * as Toast from "../ui/toast"
import * as Toaster from "./toaster"

/** `RequestedToast` → `Toaster.push`; a request `id` updates its toast in place. */

const available = {
	intent: "info",
	title: "Update",
	description: null,
	id: "update",
	isSticky: true,
	action: { label: "Install & Restart", key: "InstallUpdate" },
} as const

describe("root toaster", () => {
	test("a request adds a toast with its kind, title and description", () => {
		const shown = Toaster.push(Toaster.init(), {
			intent: "error",
			title: "Failed",
			description: "Try again",
		})
		expect(shown.model.entries).toHaveLength(1)
		expect(shown.model.entries[0]?.variant).toBe("Error")
		expect(shown.model.entries[0]?.payload).toMatchObject({
			kind: "error",
			title: "Failed",
			maybeDescription: Option.some("Try again"),
		})
	})

	test("a page's RequestedToast goes through the root into the toaster", () => {
		const path =
			"/hazel/my-settings/linked-accounts?connection_status=error&provider=discord&error_code=db_error"
		const booted = Option.match(fromString(`http://localhost${path}`), {
			onNone: () => expect.unreachable("url"),
			onSome: (url) =>
				init(
					{
						themePreference: defaultThemePreference(),
						systemTheme: "light",
						soundSettings: DEFAULT_SOUND_SETTINGS,
						sessionStartMs: 0,
						isMobile: false,
						isCreateChannelHintDismissed: false,
					},
					url,
				),
		})
		expect(booted.model.toasts.entries.map((entry) => entry.payload)).toMatchObject([
			{
				kind: "error",
				title: "Failed to link Discord account",
				maybeDescription: Option.some("A database error occurred. Please try again."),
			},
		])
		// The kit's own Messages fold back into the slot through `GotToastsMessage`.
		const entryId = booted.model.toasts.entries[0]!.id
		const hovered = update(
			booted.model,
			Message.GotToastsMessage({
				message: Toaster.Message.GotToastMessage({
					message: Toast.Message.HoveredEntry({ entryId }),
				}),
			}),
		)
		expect(hovered.model.toasts.entries[0]?.isHovered).toBe(true)
	})

	test("an action click dismisses the toast and reports the action", () => {
		const shown = Toaster.push(Toaster.init(), available).model
		const entryId = shown.entries[0]!.id
		const clicked = Toaster.update(
			shown,
			Toaster.Message.ClickedAction({ entryId, action: "InstallUpdate" }),
		)
		expect(clicked.action).toBe("InstallUpdate")
		expect(clicked.model.entries[0]?.animation.isShowing).toBe(false)
	})

	test("the kit's own Messages report no action", () => {
		const shown = Toaster.push(Toaster.init(), available).model
		const entryId = shown.entries[0]!.id
		const dismissed = Toaster.update(
			shown,
			Toaster.Message.GotToastMessage({ message: Toast.Message.Dismissed({ entryId }) }),
		)
		expect(dismissed.action).toBeUndefined()
		expect(dismissed.model.entries[0]?.animation.isShowing).toBe(false)
	})
})

describe("update toast replacement", () => {
	test("a failure replaces availability in place, dropping the action and starting a timer", () => {
		const initial = Toaster.push(Toaster.init(), available).model
		const failed = Toaster.push(initial, {
			intent: "error",
			title: "Failed",
			description: null,
			id: "update",
		})
		expect(failed.model.entries).toHaveLength(1)
		expect(failed.model.entries[0]).toMatchObject({
			id: initial.entries[0]!.id,
			variant: "Error",
			pendingDismissVersion: 1,
			payload: { kind: "error", title: "Failed", maybeAction: Option.none() },
		})
		expect(Option.isSome(failed.model.entries[0]!.maybeDuration)).toBe(true)
		expect(failed.commands?.map((command) => command.name)).toEqual(["WaitBeforeDismissal"])
	})

	test("creates a new toast after its action dismissed the previous one", () => {
		const initial = Toaster.push(Toaster.init(), available).model
		const entryId = initial.entries[0]!.id
		const clicked = Toaster.update(
			initial,
			Toaster.Message.ClickedAction({ entryId, action: "InstallUpdate" }),
		)
		const downloading = Toaster.push(clicked.model, {
			intent: "loading",
			title: "Downloading",
			description: null,
			id: "update",
		}).model
		expect(downloading.entries).toHaveLength(2)
		expect(downloading.entries[1]?.id).not.toBe(entryId)
		expect(downloading.entries[1]?.animation.isShowing).toBe(true)
	})
})
