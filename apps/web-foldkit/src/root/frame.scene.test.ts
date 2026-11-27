// @vitest-environment jsdom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { HtmlLocator, HtmlScene } from "@effect/ui/html/testing"
import { Locator } from "@effect/ui/testing"
import { describe, expect, test } from "vitest"
import { ada, flagsOf, owner, shellSignedIn } from "../test/root-fixtures"
import { App, type Boot } from "./app"
import { TrackAssistantColumn } from "./assistant"
import { AdoptRegion, RunFoldkitHost } from "./foldkit"
import { SIDEBAR_CONTAINER_CLASS, SIDEBAR_GAP_CLASS, SettleAfterPaint } from "./frame"
import { type AppModel, hostContextOf } from "./logic"

/** The shell's frame around every page: the nav rail, the phone's tab and top bars, and the paint marks. */

const boot: Boot = {
	...flagsOf(),
	isCreateChannelHintDismissed: false,
	aiPanel: { isOpen: false, width: null },
}

/** The root component's view of `model`; no end check, so the host's mounts may keep running. */
// The Foldkit host and the regions it fills keep running beside the shell's view.
const hostMount = (model: AppModel) => RunFoldkitHost({ context: hostContextOf(model) })
const frame = (model: AppModel) => HtmlScene.start(App, { route: model.route, boot }).given(model)
const onPhone = (path: string) => shellSignedIn(path, owner, { isMobile: true })

const navItem = (name: string) => HtmlLocator.role("link", { name })
const tabs = HtmlLocator.role("navigation", { name: "Tabs" })
const inTabs = (locator: Locator.Locator) => Locator.inside(tabs, locator)
// A rail item is a `role="link"` around the anchor that carries `aria-current`.
const currentIn = (name: string) => Locator.inside(navItem(name), Locator.attr("aria-current", "page"))

describe("nav rail", () => {
	test("marks the section of the current route", () => {
		frame(shellSignedIn("/hazel/settings/team"))
			.expect(navItem("Chat"))
			.toExist()
			.expect(currentIn("Settings"))
			.toExist()
			.expect(currentIn("Chat"))
			.toBeAbsent()
			.expect(currentIn("Home"))
			.toBeAbsent()
	})

	test("an account settings page is in Settings too", () => {
		frame(shellSignedIn("/hazel/my-settings/keybinds"))
			.expect(currentIn("Settings"))
			.toExist()
			.expect(currentIn("Chat"))
			.toBeAbsent()
	})
})

describe("the docked sidebar's first paint", () => {
	// Today's sidebar appears at its width: no width (or any) transition runs while the app loads.
	test("the first frame is static: the dock is unsettled and settles after it paints", () => {
		const model = shellSignedIn("/hazel/settings/team")
		frame(model)
			.expect(Locator.attr("data-slot", "sidebar"))
			.toExist()
			.expect(Locator.attr("data-settled"))
			.toBeAbsent()
			.expectMount(SettleAfterPaint())
	})

	test("every transition utility on the dock waits for data-settled", () => {
		const motion = /^(transition|duration-|ease-)/
		for (const className of [SIDEBAR_GAP_CLASS, SIDEBAR_CONTAINER_CLASS]) {
			const ungated = className
				.split(/\s+/)
				.filter((token) => motion.test(token.split(":").at(-1) ?? ""))
				.filter((token) => !token.startsWith("group-data-settled:"))
			expect(ungated).toEqual([])
		}
	})
})

describe("the last screen's paint", () => {
	// The host's sidebar marks itself loading inside this (`app/shell.scene.test.ts`).
	test("the shell is named for the signed-in user: a paint is only kept under its own user", () => {
		frame(shellSignedIn("/hazel/chat"))
			.expect(Locator.attr("data-paint", "shell"))
			.toHaveAttribute("data-paint-user", ada.id)
	})
})

describe("mobile", () => {
	test("a native section's top bar opens its own sidebar sheet; the tab bar has no Menu tab", () => {
		const model = onPhone("/hazel/settings/groups")
		const s = frame(model)
			// Settings is the gear in the chat list's header, not a tab.
			.expect(inTabs(navItem("Settings")))
			.toBeAbsent()
			.expect(inTabs(HtmlLocator.role("button", { name: /Menu/ })))
			.toBeAbsent()
			.expectMount(hostMount(model))
			.expectMount(AdoptRegion({ region: "page" }))
			.expectMount(TrackAssistantColumn())
			.expectMount(AdoptRegion({ region: "overlays" }))
			.click(HtmlLocator.role("button", { name: "Settings menu" }))
		// Settings' sheet is the shell's (`sections.ts`, `logic.test.ts`); the host is not asked.
		expect(s.pending).toEqual([])
	})

	test("the DMs tab is the direct messages list", () => {
		frame(onPhone("/hazel/chat/dms"))
			.expect(inTabs(navItem("DMs")))
			.toHaveAttribute("aria-current", "page")
			.expect(inTabs(navItem("Home")))
			.toHaveAttribute("aria-current", false)
	})

	test("the Home tab is the chat list, and Members opens from it with a way back", () => {
		frame(onPhone("/hazel/chat"))
			.expect(inTabs(navItem("Home")))
			.toHaveAttribute("aria-current", "page")
		frame(onPhone("/hazel"))
			.expect(HtmlLocator.role("link", { name: "Back to Chats" }))
			.toHaveAttribute("href", "/hazel/chat")
			.expect(inTabs(navItem("Home")))
			.toHaveAttribute("aria-current", "page")
	})

	test("the bar is Slack's: Home, DMs, Activity, More, and a search button; Customers is under More", () => {
		frame(onPhone("/hazel/more"))
			.expect(inTabs(navItem("Customers")))
			.toBeAbsent()
			.expect(inTabs(navItem("More")))
			.toHaveAttribute("aria-current", "page")
			.expect(inTabs(navItem("More")))
			.toHaveAttribute("href", "/hazel/more")
			.expect(inTabs(HtmlLocator.role("button", { name: "Search" })))
			.toExist()
	})
})
