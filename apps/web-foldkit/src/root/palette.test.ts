// @vitest-environment jsdom
import { channelHref, customerHref, messageHref } from "@hazel/shared-screens/palette/hrefs"
import { ChannelId, CustomerAccountId } from "@hazel/schema"
import { Option } from "effect"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../page/out-message"
import { AppRoute, chatMessageHref, hrefOf } from "../route"
import { hostRequestsOf, shellSignedIn } from "../test/root-fixtures"
import { hostContextOf, update } from "./logic"
import { AppMessage } from "./message"
import { paletteDestinations, paletteShortcuts } from "./palette"

/** The shell's command palette: every way of opening it, closing it, and what it hands the host. */

const signed = shellSignedIn("/hazel/chat")
const opened = (message: AppMessage) => update(signed, message).model.palette

describe("opening", () => {
	test("the keys, the tab bar and the host's requests open a fresh palette on their page", () => {
		expect(opened(AppMessage.PressedHotkey({ actionId: "commandPalette.open" }))).toMatchObject({
			page: "home",
			isOpen: true,
		})
		expect(opened(AppMessage.PressedHotkey({ actionId: "search.open" }))?.page).toBe("search")
		expect(opened(AppMessage.PressedMobileSearch())?.page).toBe("search")
		const browse = PageOutMessage.RequestedCommandPalette({ page: "home" })
		expect(opened(AppMessage.ReceivedHostOut({ out: { _tag: "Page", outMessage: browse } }))?.page).toBe(
			"home",
		)
	})

	test("opening again mounts a new palette (a new key); closing keeps it mounted, shut", () => {
		const key = AppMessage.PressedHotkey({ actionId: "commandPalette.open" })
		const first = update(signed, key).model
		const second = update(first, key).model
		expect(second.palette?.opened).toBe((first.palette?.opened ?? 0) + 1)
		const closed = update(second, AppMessage.RequestedClosePalette()).model
		expect(closed.palette).toMatchObject({ opened: second.palette?.opened, isOpen: false })
		expect(hostContextOf(second).isPaletteOpen).toBe(true)
		expect(hostContextOf(closed).isPaletteOpen).toBe(false)
	})
})

describe("what the palette hands the host", () => {
	test("the AI panel and a picked status", () => {
		expect(hostRequestsOf(update(signed, AppMessage.RequestedAiPanelFromPalette()).commands)).toEqual([
			{ _tag: "RequestedAiPanel" },
		])
		expect(
			hostRequestsOf(update(signed, AppMessage.PickedPaletteStatus({ status: "dnd" })).commands),
		).toEqual([{ _tag: "PickedPresenceStatus", status: "dnd" }])
	})
})

describe("the palette's data", () => {
	test("its links are the web's routes", () => {
		const channelId = ChannelId.make("00000005-0000-4000-8000-000000000001")
		const accountId = CustomerAccountId.make("0000000c-0000-4000-8000-000000000001")
		expect(channelHref("hazel", channelId)).toBe(
			hrefOf(AppRoute.ChatChannel({ orgSlug: "hazel", channelId })),
		)
		expect(messageHref("hazel", channelId, "m1")).toBe(chatMessageHref("hazel", channelId, "m1"))
		expect(customerHref("hazel", accountId, null)).toBe(
			hrefOf(AppRoute.CustomerDetail({ orgSlug: "hazel", accountId, tab: Option.none() })),
		)
		expect(customerHref("hazel", accountId, "users")).toBe(
			hrefOf(AppRoute.CustomerDetail({ orgSlug: "hazel", accountId, tab: Option.some("users") })),
		)
	})

	test("pages keep today's groups, the pinned one first", () => {
		const pages = paletteDestinations("hazel")
		expect(pages[0]).toMatchObject({ id: "home", group: "Navigation", pinned: true, href: "/hazel" })
		expect(pages.find((page) => page.id === "settingsTeam")).toMatchObject({
			group: "Workspace settings",
			href: "/hazel/settings/team",
			pinned: false,
		})
	})

	test("key hints are today's labels; an unbound AI key shows none", () => {
		expect(paletteShortcuts("Mod+J", "mac")).toMatchObject({ search: "⇧⌘F", aiPanel: "⌘J" })
		expect(paletteShortcuts(null, "windows").aiPanel).toBeNull()
	})
})
