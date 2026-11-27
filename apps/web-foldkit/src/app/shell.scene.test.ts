// @vitest-environment jsdom
import { Mount, Subscription, expect as sceneExpect, given, role, scene } from "foldkit/scene"
import { describe, test } from "vitest"
import { AutoFocusSearch } from "../page/home/commands"
import { Message as HomeMessage } from "../page/home/message"
import { changedContext, rootScene, signedIn } from "../test/root-fixtures"

/** The host's parts of the phone's org shell. */

// The tab bar and top bars are the shell's (`root/frame.scene.test.ts`); the host draws the rest.
describe("mobile", () => {
	const toPhone = (path: string) => {
		const desktop = signedIn(path)
		return { desktop, phone: changedContext(desktop, { isMobile: true }) }
	}
	// The chat list, the sidebar sheets and their paint are the shell's (`root/sections.scene.test.ts`).
	test("a phone leaves the member search's keyboard down", () => {
		const home = toPhone("/hazel")
		scene(
			rootScene,
			given(home.desktop),
			// The desktop focuses the member search; a phone leaves its keyboard down.
			Mount.resolve(AutoFocusSearch, HomeMessage.CompletedFocusSearch()),
			Subscription.emit(home.phone),
			Mount.expectEnded(AutoFocusSearch),
		)
	})

	test("Customers is under More", () => {
		const { desktop, phone } = toPhone("/hazel/more")
		scene(
			rootScene,
			given(desktop),
			Subscription.emit(phone),
			sceneExpect(role("link", { name: /Customers/ })).toHaveAttr("href", "/hazel/customers"),
		)
	})
})
