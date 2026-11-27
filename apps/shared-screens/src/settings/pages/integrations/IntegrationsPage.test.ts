// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { describe, expect, test } from "vitest"
import { Navigate, OpenModal } from "../../../app/requests"
import { adaId, button, orgId, session } from "../../integrations/test-support"
import { IntegrationsMessage, IntegrationsPageNoDeps } from "./IntegrationsPage"

/** `/:org/settings/integrations`: every integration, its status, and the way to its page. */

const CONNECTIONS = `connections:"${orgId}"`
const USER_CONNECTIONS = `userConnections:"${orgId}","${adaId}"`
const connection = (provider: string, isActive = true) => ({
	provider,
	isActive,
	externalAccountName: null,
	hasInstallationId: false,
})

const start = (webhooks: ReadonlyArray<string> = []) =>
	Scene.start(IntegrationsPageNoDeps, { orgSlug: "hazel", session }).loaded("webhooks", webhooks)
const card = (s: ReturnType<typeof start>, name: string) =>
	s.all(Locator.tag("hz:frame")).find((node) => Locator.textOf(node).includes(name))

describe("integrations page", () => {
	test("says which integrations are connected, the member's own and webhooks included", () => {
		const s = start(["openstatus"])
			.subscription(
				CONNECTIONS,
				IntegrationsMessage.UpdatedConnections({
					connections: [connection("linear"), connection("github", false)],
				}),
			)
			.subscription(
				USER_CONNECTIONS,
				IntegrationsMessage.UpdatedUserConnections({ connections: [connection("t3code")] }),
			)
		const textOf = (name: string) => Locator.textOf(card(s, name) ?? s.root)
		expect(textOf("Linear")).toContain("Connected")
		expect(textOf("GitHub")).toContain("Not connected")
		expect(textOf("T3 Code")).toContain("Connected")
		expect(textOf("OpenStatus")).not.toContain("Not connected")
		expect(textOf("Figma")).toContain("Coming soon")
		s.expect(button("Open Figma")).toBeAbsent()
	})

	test("filters by category, and opens an integration's page", () => {
		start()
			.fire(button("Communication"), "press")
			.expect(button("Open Slack"))
			.toExist()
			.expect(button("Open Linear"))
			.toBeAbsent()
			.fire(button("Open Slack"), "press")
			.expectExact(Navigate.make({ href: "/hazel/settings/integrations/slack", replace: false }))
			.resolve(Navigate, Component.noop)
	})

	test("asks for a missing integration", () => {
		start()
			.fire(button("Request integration"), "press")
			.expectExact(OpenModal.make({ modal: { _tag: "RequestIntegration" } }))
			.resolve(OpenModal, Component.noop)
	})
})
