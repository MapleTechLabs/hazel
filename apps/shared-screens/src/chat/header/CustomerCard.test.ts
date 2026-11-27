// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { ChannelId, CustomerAccountId, OrganizationId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { ShowToast } from "../../app/requests"
import {
	CustomerCard,
	type CustomerGlance,
	hasGlance,
	lastActiveText,
	revenueText,
	seatsText,
	signalCountText,
} from "./CustomerCard"
import { JoinBanner, JoinBannerMessage, JoinChannel } from "./JoinBanner"

/** The customer chip and its card; the non-member's join banner. */

const NOW = Date.parse("2026-11-26T12:00:00.000Z")
const channelId = ChannelId.make("00000005-0000-4000-8000-000000000003")

const customer = (overrides: Partial<CustomerGlance> = {}): CustomerGlance => ({
	channelId,
	organizationId: OrganizationId.make("00000002-0000-4000-8000-000000000001"),
	accountId: CustomerAccountId.make("0000000c-0000-4000-8000-000000000001"),
	accountName: "Linear",
	accountLogoUrl: null,
	lifecycleStage: "active",
	planName: "Pro",
	mrrMinor: 240_000,
	currency: "USD",
	ownerUserId: UserId.make("00000001-0000-4000-8000-000000000002"),
	seatsUsed: 12,
	seatsLimit: 20,
	lastActiveDay: "2026-11-23",
	openSignalCount: 0,
	topSignals: [],
	sourceLinks: [],
	company: null,
	...overrides,
})

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const chip = byProp("button", "label", "Linear")

const start = (glance: CustomerGlance, isMobile: boolean) =>
	Scene.start(CustomerCard, {
		customer: glance,
		ownerName: "Grace Hopper",
		customerHref: "/hazel/customers/c1",
		queueHref: "/hazel/customers/attention",
		nowMs: NOW,
		isMobile,
	})

describe("customer card", () => {
	test("desktop: a hover card until the chip is pressed, which pins it; dismiss unpins", () => {
		const s = start(customer(), false)
		expect(s.get(Locator.tag("hz:popover")).props).toMatchObject({ open: true, trigger: "hover" })
		s.fire(chip, "press")
		expect(s.get(Locator.tag("hz:popover")).props?.["trigger"]).toBeUndefined()
		expect(s.get(chip).props?.["selected"]).toBe(true)
		s.fire(Locator.tag("hz:popover"), "dismiss")
		expect(s.get(Locator.tag("hz:popover")).props?.["trigger"]).toBe("hover")
	})

	test("the card shows the account's facts", () => {
		const s = start(customer(), false)
		s.expect(byProp("property", "label", "Revenue")).toExist()
		s.expect(byProp("badge", "label", "Active")).toExist()
		s.expect(byProp("section", "title", "No open signals")).toExist()
	})

	test("before the glance syncs, only who it is and the way to the page", () => {
		const s = start(customer({ lifecycleStage: null }), false)
		s.expect(byProp("property", "label", "Revenue")).toBeAbsent()
		s.expect(byProp("link", "label", "Open customer")).toExist()
	})

	test("a phone opens the card in a sheet", () => {
		const s = start(customer(), true)
		s.expect(Locator.tag("hz:popover")).toBeAbsent()
		s.fire(chip, "press")
		expect(s.get(Locator.tag("hz:sheet")).props?.["open"]).toBe(true)
		s.fire(Locator.tag("hz:sheet"), "dismiss")
		expect(s.get(Locator.tag("hz:sheet")).props?.["open"]).toBeUndefined()
	})

	test("the facts read as today's", () => {
		expect(revenueText(customer())).toBe("$2,400/mo · Pro")
		expect(revenueText(customer({ mrrMinor: 0, planName: null }))).toBeNull()
		expect(seatsText(customer())).toBe("12 of 20")
		expect(lastActiveText("2026-11-26", NOW)).toBe("Today")
		expect(signalCountText(1)).toBe("1 open signal")
		expect(hasGlance(customer({ lifecycleStage: null }))).toBe(false)
	})
})

describe("join banner", () => {
	const userId = UserId.make("00000001-0000-4000-8000-000000000001")
	const join = byProp("button", "label", "Join #support")
	const preview = {
		channel: { id: channelId, name: "support", icon: null, type: "public", parentChannelId: null },
		isJoining: false,
	}

	test("Join is pending until it settles; success toasts", () => {
		const s = Scene.start(JoinBanner, { channelId, userId }).given(preview)
		s.expect(byProp("emptyState", "title", "support")).toExist()
		s.fire(join, "press").expectExact(JoinChannel.make({ channelId, userId }))
		expect(s.get(join).props?.["loading"]).toBe(true)
		s.resolve(JoinChannel, JoinBannerMessage.SucceededJoin())
			.expectExact(
				ShowToast.make({
					toast: { intent: "success", title: "Successfully joined channel", description: null },
				}),
			)
			.resolve(ShowToast, Component.noop)
		expect(s.get(join).props?.["loading"]).toBeUndefined()
	})

	test("a failed join says why", () => {
		Scene.start(JoinBanner, { channelId, userId })
			.given(preview)
			.fire(join, "press")
			.resolve(JoinChannel, JoinBannerMessage.FailedJoin({ reason: "NotFound" }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Channel not found",
						description: "This channel may have been deleted.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
	})
})
