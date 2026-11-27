// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Locator, Scene } from "@effect/ui/testing"
import { CustomerAccountId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { channelNameError } from "../../name-rules"
import { button, byProp, channelId, orgId, session } from "../../test-support"
import { LinkCustomer, OverviewMessage, OverviewPageNoDeps, SaveChannel } from "./OverviewPage"

/** Channel settings, Overview: the icon and name form, and the channel's customer. */

const CHANNEL = `channel:"${channelId}"`
const CUSTOMER = `customer:"${channelId}"`
const acme = CustomerAccountId.make("00000012-0000-4000-8000-000000000001")
const globex = CustomerAccountId.make("00000012-0000-4000-8000-000000000002")

const start = (member = false) =>
	Scene.start(OverviewPageNoDeps, {
		channelId,
		session: session(member),
		customerHrefPrefix: "/hazel/customers/",
	})
		.subscription(CHANNEL, OverviewMessage.UpdatedChannel({ channel: { name: "general", icon: null } }))
		.subscription(CUSTOMER, OverviewMessage.UpdatedCustomer({ customer: null }))

const field = Locator.tag("hz:textField")
// The form set the loaded name as its first Model edit.
const edit = (value: string) => ({ value, rev: 1, edit: 1 })

describe("channel settings overview", () => {
	test("the name rules match today's copy", () => {
		expect(channelNameError("")).toBe("Channel name is required")
		expect(channelNameError("a")).toBe("Channel name must be at least 2 characters")
		expect(channelNameError("a".repeat(101))).toBe("Channel name must be at most 100 characters")
		expect(channelNameError("general")).toBeNull()
	})

	test("waits for the channel, then saves only a changed, valid name", () => {
		const s = Scene.start(OverviewPageNoDeps, {
			channelId,
			session: session(false),
			customerHrefPrefix: null,
		})
		s.expect(field).toBeAbsent()
		s.subscription(CHANNEL, OverviewMessage.UpdatedChannel({ channel: { name: "general", icon: null } }))
		expect(s.get(button("Save changes")).props?.["disabled"]).toBe(true)
		s.fire(field, "change", edit("a"))
		expect(s.get(field).props?.["error"]).toBe("Channel name must be at least 2 characters")
		expect(s.get(button("Save changes")).props?.["disabled"]).toBe(true)
		s.fire(field, "change", edit("support"))
			.fire(button("Save changes"), "press")
			.expectExact(SaveChannel.make({ id: channelId, name: "support", icon: null }))
		s.expect(button("Saving...")).toExist()
		s.resolve(SaveChannel, OverviewMessage.SucceededSave())
		expect(s.get(button("Save changes")).props?.["disabled"]).toBe(true)
	})

	test("a later channel update keeps the edits", () => {
		const s = start().fire(field, "change", edit("renamed"))
		s.subscription(CHANNEL, OverviewMessage.UpdatedChannel({ channel: { name: "other", icon: null } }))
		expect(s.get(field).props?.["value"]).toMatchObject({ text: "renamed" })
	})

	test("a channel's icon is cleared, which makes the form dirty", () => {
		const s = Scene.start(OverviewPageNoDeps, {
			channelId,
			session: session(false),
			customerHrefPrefix: null,
		})
			.subscription(
				CHANNEL,
				OverviewMessage.UpdatedChannel({ channel: { name: "general", icon: "🚀" } }),
			)
			.subscription(CUSTOMER, OverviewMessage.UpdatedCustomer({ customer: null }))
		expect(s.get(button("Save changes")).props?.["disabled"]).toBe(true)
		s.fire(button("Remove channel icon"), "press").expect(button("Remove channel icon")).toBeAbsent()
		expect(s.get(button("Save changes")).props?.["disabled"]).toBeUndefined()
	})

	test("links a customer from the picker, and unlinks it", () => {
		const s = start().fire(button("Link to customer"), "press")
		s.subscription(
			`customers:"${orgId}"`,
			OverviewMessage.UpdatedCustomers({
				customers: [
					{ id: acme, name: "Acme" },
					{ id: globex, name: "Globex" },
				],
			}),
		)
		s.fire(byProp("item", "title", "Globex"), "press").expectExact(
			LinkCustomer.make({ organizationId: orgId, channelId, accountId: globex }),
		)
		s.expect(button("Linking…")).toExist()
		s.resolve(LinkCustomer, OverviewMessage.SettledCustomerLink({ failed: false }))
			.subscription(
				CUSTOMER,
				OverviewMessage.UpdatedCustomer({
					customer: { channelId, accountId: globex, accountName: "Globex" },
				}),
			)
			.expect(byProp("link", "href", `/hazel/customers/${globex}`))
			.toExist()
			.fire(button("Unlink"), "press")
			.expectExact(LinkCustomer.make({ organizationId: orgId, channelId, accountId: null }))
		s.resolve(LinkCustomer, OverviewMessage.SettledCustomerLink({ failed: true }))
			.expect(button("Unlink"))
			.toExist()
	})
})
