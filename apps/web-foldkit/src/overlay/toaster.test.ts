// @vitest-environment jsdom
import { Option } from "effect"
import { fromString } from "foldkit/url"
import { describe, expect, test } from "vitest"
import { init, Message, update } from "../main"
import * as Toast from "../ui/toast"
import { DEFAULT_SOUND_SETTINGS } from "../notification-sound"
import { defaultThemePreference } from "../theme"
import { init as initToasts, push } from "./toaster"

/** `RequestedToast` → the kit's `showRequest`; a sonner `id` updates its toast in place. */

describe("root toaster", () => {
	test("a request adds a toast with the kit's kind, title and description", () => {
		const shown = push(initToasts(), { intent: "error", title: "Failed", description: "Try again" })
		expect(shown.model.toaster.toasts).toHaveLength(1)
		expect(shown.model.toaster.toasts[0]).toMatchObject({ kind: "error", title: "Failed", description: "Try again" })
	})

	test("a toast with a known id replaces it (loading, then success)", () => {
		const loading = push(initToasts(), { intent: "loading", title: "Saving...", description: null, id: "save" })
		const done = push(loading.model, { intent: "success", title: "Saved", description: null, id: "save" })
		expect(done.model.toaster.toasts).toHaveLength(1)
		expect(done.model.toaster.toasts[0]).toMatchObject({ kind: "success", title: "Saved" })
		const other = push(done.model, { intent: "info", title: "Other", description: null })
		expect(other.model.toaster.toasts.map((toast) => toast.title)).toEqual(["Other", "Saved"])
	})

	test("a page's RequestedToast goes through the root into the toaster", () => {
		const path = "/hazel/my-settings/linked-accounts?connection_status=error&provider=discord&error_code=db_error"
		const booted = Option.match(fromString(`http://localhost${path}`), {
			onNone: () => expect.unreachable("url"),
			onSome: (url) =>
				init(
					{
						themePreference: defaultThemePreference(),
						systemTheme: "light",
						soundSettings: DEFAULT_SOUND_SETTINGS,
					},
					url,
				),
		})
		expect(booted.model.toasts.toaster.toasts).toMatchObject([
			{ kind: "error", title: "Failed to link Discord account", description: "db_error" },
		])
		// The kit's own Messages fold back into the slot through `GotToastsMessage`.
		const hovered = update(booted.model, Message.GotToastsMessage({ message: Toast.Message.HoveredToaster() }))
		expect(hovered.model.toasts.toaster.isExpanded).toBe(true)
	})
})
