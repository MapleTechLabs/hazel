// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Locator, Scene } from "@effect/ui/testing"
import { DEFAULT_CONNECTION_CONFIG } from "@hazel/customer-integrations"
import { CustomerConnectionId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { TextField } from "@hazel/ui/vocabulary/index"
import { Redacted } from "effect"
import { describe, expect, test } from "vitest"
import type { Session } from "../../../app/session"
import { ModalEvents } from "../../../modals/feedback"
import {
	ConnectSource,
	ConnectSourceMessage,
	ConnectSourceModalNoDeps,
	SaveWebhookSecret,
} from "./ConnectSourceModal"

/** Connect a source: the key and matching options, then the webhook step once the key works. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = OrganizationId.make(uuid(1))
const connectionId = CustomerConnectionId.make(uuid(100))
const session: Session = {
	auth: "SignedIn",
	user: {
		id: UserId.make(uuid(2)),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: OrganizationMemberId.make(uuid(3)), role: "owner" },
	orgSlug: "hazel",
}

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const button = (label: string) => byProp("button", "label", label)
const field = (label: string) => byProp("textField", "label", label)
const typed = (value: string) => ({ value, rev: 1, edit: 0 })

const start = (reconnectId: CustomerConnectionId | null = null) =>
	Scene.start(ConnectSourceModalNoDeps, {
		session,
		provider: "stripe",
		reconnectId,
		config: DEFAULT_CONNECTION_CONFIG.stripe,
		backendUrl: "https://api.hazel.test",
	})

describe("connect source modal", () => {
	test("the key step lists the permissions; an empty key can't be tested", () => {
		const s = start()
		s.expect(byProp("dialog", "title", "Connect Stripe"))
			.toExist()
			.expect(field("Restricted API key"))
			.toExist()
		expect(s.get(button("Test and connect")).props?.["disabled"]).toBe(true)
		expect(s.get(field("Restricted API key")).props).toMatchObject({ secret: true, monospace: true })
	})

	test("Test and connect sends the key and config, then shows the webhook URL and secret", () => {
		const s = start()
			.fire(field("Restricted API key"), "change", typed(" rk_live_1 "))
			.fire(button("Test and connect"), "press")
			.expectExact(
				ConnectSource.make({
					organizationId,
					provider: "stripe",
					reconnectId: null,
					apiKey: Redacted.make("rk_live_1"),
					config: DEFAULT_CONNECTION_CONFIG.stripe,
				}),
			)
		expect(s.get(button("Test and connect")).props?.["loading"]).toBe(true)
		s.resolve(
			ConnectSource,
			ConnectSourceMessage.SucceededConnect({
				connected: { connectionId, accountName: "Northwind Inc." },
			}),
		)
			.expect(byProp("banner", "title", "Connection works"))
			.toExist()
			.expect(field("Restricted API key"))
			.toBeAbsent()
		expect(s.get(field("Webhook URL")).props).toMatchObject({
			value: TextField.set(
				TextField.empty,
				`https://api.hazel.test/webhooks/customers/stripe/${organizationId}/${connectionId}`,
			),
			copyable: true,
			readOnly: true,
		})
		s.fire(field("Signing secret"), "change", typed("whsec_1"))
			.fire(button("Save secret and finish"), "press")
			.expectExact(
				SaveWebhookSecret.make({
					organizationId,
					connectionId,
					webhookSecret: Redacted.make("whsec_1"),
				}),
			)
			.resolve(SaveWebhookSecret, ConnectSourceMessage.SucceededSaveSecret())
			.emitted(ModalEvents.RequestedClose())
	})

	test("a reconnect's refused key says so and offers to test again; Cancel closes", () => {
		const s = start(connectionId)
			.expect(byProp("dialog", "title", "Reconnect Stripe"))
			.toExist()
			.fire(field("Restricted API key"), "change", typed("rk_bad"))
			.fire(button("Test and connect"), "press")
			.expectExact(
				ConnectSource.make({
					organizationId,
					provider: "stripe",
					reconnectId: connectionId,
					apiKey: Redacted.make("rk_bad"),
					config: DEFAULT_CONNECTION_CONFIG.stripe,
				}),
			)
			.resolve(ConnectSource, ConnectSourceMessage.FailedConnect({ reason: "Refused" }))
		expect(s.get(byProp("banner", "title", "Key was refused")).props?.["tone"]).toBe("danger")
		s.expect(button("Test again"))
			.toExist()
			.fire(button("Cancel"), "press")
			.emitted(ModalEvents.RequestedClose())
	})
})
