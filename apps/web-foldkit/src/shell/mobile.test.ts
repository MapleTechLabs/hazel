import { describe, expect, test } from "vitest"
import { routeOfPath } from "../route"
import { mobileChromeOf } from "./mobile"

/** What a phone draws around each kind of page: the tab bar, and a top bar where the page has none. */

const channel = "00000000-0000-4000-8000-0000000000c1"
const chromeAt = (path: string) => mobileChromeOf(routeOfPath(path))

describe("mobileChromeOf", () => {
	test("a conversation fills the screen: no tab bar, and its own header leads back", () => {
		expect(chromeAt(`/hazel/chat/${channel}`)).toEqual({ hasTabBar: false, topBar: null })
		expect(chromeAt(`/hazel/chat/${channel}/files`)).toEqual({ hasTabBar: false, topBar: null })
		expect(chromeAt(`/hazel/channels/${channel}/settings/overview`).hasTabBar).toBe(false)
	})

	test("the chat list draws its own header; Members, opened from it, leads back to it", () => {
		expect(chromeAt("/hazel/chat")).toEqual({ hasTabBar: true, topBar: null })
		expect(chromeAt("/hazel")).toEqual({
			hasTabBar: true,
			topBar: { _tag: "Back", title: "Members", href: "/hazel/chat" },
		})
	})

	test("a section with a secondary sidebar gets a top bar whose menu opens it", () => {
		expect(chromeAt("/hazel/settings/team").topBar).toEqual({ _tag: "Section", title: "Settings" })
		expect(chromeAt("/hazel/notifications").topBar).toEqual({ _tag: "Section", title: "Activity" })
		expect(chromeAt("/hazel/customers").topBar).toEqual({ _tag: "Section", title: "Customers" })
	})

	test("a page outside an organization gets no shell chrome", () => {
		expect(chromeAt("/sign-in")).toEqual({ hasTabBar: false, topBar: null })
	})
})
