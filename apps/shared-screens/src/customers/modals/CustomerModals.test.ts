// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Locator, Scene } from "@effect/ui/testing"
import { CustomerAccountId, OrganizationId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { ModalEvents } from "../../modals/feedback"
import type { AccountRow } from "../data/queries"
import {
	CustomerEnvironmentMessage,
	CustomerEnvironmentModalNoDeps,
	SetCustomerEnvironment,
} from "./CustomerEnvironmentModal"
import {
	CustomerLinkMessage,
	CustomerLinkModalNoDeps,
	LinkCustomer,
	linkCandidates,
} from "./CustomerLinkModal"
import { CustomerRawDataModal } from "./CustomerRawDataModal"

/** The customer page's More menu dialogs: raw data, link to another customer, name environment. */

const orgId = OrganizationId.make("00000001-0000-4000-8000-000000000001")
const id = (n: number) => CustomerAccountId.make(`000000c1-0000-4000-8000-00000000000${n}`)

const row = (n: number, name: string, overrides: Partial<AccountRow> = {}) =>
	({
		id: id(n),
		name,
		domain: null,
		environment: null,
		primaryAccountId: null,
		mrrMinor: 0,
		currency: "USD",
		...overrides,
	}) as AccountRow

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const button = (label: string) => byProp("button", "label", label)

describe("customer dialogs", () => {
	test("raw data shows the JSON and closes", () => {
		const s = Scene.start(CustomerRawDataModal, { json: '{"id":"a"}' })
		expect(s.get(Locator.tag("hz:codeBlock")).props?.["code"]).toBe('{"id":"a"}')
		s.fire(button("Close"), "press").emitted(ModalEvents.RequestedClose())
	})

	test("a customer joins other customers' primaries and standalone accounts, never its own group", () => {
		const accounts = [
			row(1, "Acme", { domain: "acme.io" }),
			row(2, "Northwind"),
			row(3, "Northwind EU", { primaryAccountId: id(2), environment: "EU" }),
			row(4, "Globex", { primaryAccountId: id(1), environment: "US" }),
		]
		expect(linkCandidates(accounts, id(3), "").map((account) => account.name)).toEqual(["Acme"])
		expect(linkCandidates(accounts, id(1), "north").map((account) => account.name)).toEqual(["Northwind"])
		expect(linkCandidates(accounts, id(2), "acme.io").map((account) => account.name)).toEqual(["Acme"])
	})

	test("linking runs once for the pick; the store's refusal stays in the dialog", () => {
		const accounts = [row(1, "Acme"), row(2, "Northwind")]
		const s = Scene.start(CustomerLinkModalNoDeps, { organizationId: orgId, accountId: id(2) })
			.subscription(
				`accounts:${JSON.stringify(orgId)}`,
				CustomerLinkMessage.UpdatedAccounts({ accounts }),
			)
			.fire(Locator.tag("hz:choiceGroup"), "change", { selected: [id(1)] })
			.fire(button("Link to Acme"), "press")
			.expectExact(
				LinkCustomer.make({
					organizationId: orgId,
					accountId: id(2),
					primaryAccountId: id(1),
					primaryLabel: "Acme",
				}),
			)
			.resolve(
				LinkCustomer,
				CustomerLinkMessage.FailedLinkCustomer({ refusal: "Acme is an environment." }),
			)
		s.expect(byProp("banner", "description", "Acme is an environment.")).toExist()
	})

	test("naming the environment saves the trimmed text; empty clears it", () => {
		const props = { organizationId: orgId, accountId: id(2), name: "Northwind", environment: null }
		Scene.start(CustomerEnvironmentModalNoDeps, props)
			.fire(byProp("textField", "label", "Environment"), "submit", { value: "  EU  ", rev: 1, edit: 0 })
			.expectExact(
				SetCustomerEnvironment.make({ organizationId: orgId, accountId: id(2), environment: "EU" }),
			)
			.resolve(SetCustomerEnvironment, CustomerEnvironmentMessage.SucceededSetEnvironment())
			.emitted(ModalEvents.RequestedClose())
		Scene.start(CustomerEnvironmentModalNoDeps, { ...props, environment: "EU" })
			.fire(byProp("textField", "label", "Environment"), "submit", { value: " ", rev: 1, edit: 1 })
			.expectExact(
				SetCustomerEnvironment.make({ organizationId: orgId, accountId: id(2), environment: null }),
			)
	})
})
