// @effect-diagnostics experimentalApiUsage:off
import { describe, expect, it } from "vitest"
import { routeOfPath } from "./route"
import parity from "./route.parity.json"
import { frameOf, screens, TABS, tabOf, titleOf } from "./screens"

/** The registry's answers per route: which tab a route roots, its bar title, which pages are framed. */
describe("the screen registry", () => {
	it("roots each tab at its own route", () => {
		for (const tab of TABS) expect(tabOf(tab.root("hazel"))).toBe(tab.id)
	})

	it("gives a tab only to a tab's root", () => {
		const roots = new Set(TABS.map((tab) => tab.root("hazel")._tag))
		for (const row of parity) {
			const route = routeOfPath(row.path)
			if (tabOf(route) !== null) expect(roots).toContain(route._tag)
		}
	})

	it("draws the phone's core screens natively", () => {
		for (const tag of [
			"ChatIndex",
			"ChatDms",
			"ChatChannel",
			"NotificationsMentions",
			"NotificationsUnreads",
			"NotificationsAll",
			"OrgMore",
			"OrgHome",
			"Profile",
			"SettingsGeneral",
			"TeamSettings",
			"SettingsInvitations",
		] as const)
			expect(screens[tag]?.screen, tag).toBeTypeOf("function")
	})

	it("titles every framed page, so the phone's bar names it", () => {
		for (const row of parity) {
			const route = routeOfPath(row.path)
			const frame = frameOf(route)
			if (frame !== null) expect(frame, row.path).toBe(titleOf(route))
			if (frame !== null) expect(frame.length, row.path).toBeGreaterThan(0)
		}
	})
})
