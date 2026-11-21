import { ChannelId, CustomerAccountId, CustomerSignalRuleId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { describe, expect, test } from "vitest"
import { AppRoute } from "../route"
import { channelContext, customerContext, routeContextOf, suggestionsFor } from "./context"

/** What the panel sends as "where the member is": a page's own description, else its route's. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const accountId = Schema.decodeSync(CustomerAccountId)(uuid(1))
const channelId = Schema.decodeSync(ChannelId)(uuid(2))

describe("customerContext", () => {
	test("names the customer and the tab, with the customer as its entity", () => {
		const context = customerContext("hazel", { id: accountId, name: "Acme" }, "billing")
		expect(context).toEqual({
			label: "Acme · Billing",
			path: `/hazel/customers/${accountId}?tab=billing`,
			route: "CustomerDetail",
			entities: [{ kind: "customer", id: accountId, name: "Acme" }],
		})
	})

	test("before the account syncs it is still the customer, by id", () => {
		const context = customerContext("hazel", { id: accountId, name: null }, "overview")
		expect(context.label).toBe("Customer · Overview")
		expect(context.entities).toEqual([{ kind: "customer", id: accountId }])
	})
})

describe("channelContext", () => {
	test("names the channel", () => {
		const context = channelContext("hazel", { id: channelId, name: "general" })
		expect(context.label).toBe("#general")
		expect(context.entities).toEqual([{ kind: "channel", id: channelId, name: "general" }])
	})
})

describe("routeContextOf", () => {
	test("a page that says nothing gets its section, path and route ids", () => {
		const ruleId = Schema.decodeSync(CustomerSignalRuleId)(uuid(3))
		const context = routeContextOf(AppRoute.CustomersSettingsSignalRule({ orgSlug: "hazel", ruleId }))
		expect(context).toMatchObject({
			label: "Customers",
			route: "CustomersSettingsSignalRule",
			entities: [{ kind: "signal_rule", id: ruleId }],
		})
	})

	test("a route without ids has no entities", () => {
		expect(routeContextOf(AppRoute.SettingsIntegrations({ orgSlug: "hazel" }))).toMatchObject({
			label: "Settings",
			entities: [],
		})
	})

	test("outside an organization there is no context", () => {
		expect(
			routeContextOf(AppRoute.SignIn({ redirectUrl: Option.none(), error: Option.none() })),
		).toBeNull()
	})
})

describe("suggestionsFor", () => {
	test("adapts the chips to the page", () => {
		const customer = customerContext("hazel", { id: accountId, name: "Acme" }, "overview")
		expect(suggestionsFor(customer)).toContain("Summarize this customer's health")
		expect(suggestionsFor(channelContext("hazel", { id: channelId, name: "general" }))).toContain(
			"Summarize this channel",
		)
		expect(suggestionsFor(null)).toHaveLength(3)
	})
})
