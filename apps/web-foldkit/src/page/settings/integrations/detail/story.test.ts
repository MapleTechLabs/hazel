// @vitest-environment jsdom
import { Option } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { makeShared, organizationId, storyUpdate } from "../../../../test/pages-fixtures"
import { ConnectApiKey, Disconnect, GetOAuthUrl } from "./command"
import { Message } from "./message"
import { init, update } from "./update"

/** The integration detail update: organization gating, config toggles and request guards. */

const shared = makeShared()
const run = storyUpdate(update, shared)
const pageFor = (integrationId: string) =>
	init({
		_tag: "SettingsIntegration",
		orgSlug: "hazel",
		integrationId,
		connectionStatus: Option.none(),
		errorCode: Option.none(),
	}).model
const linear = pageFor("linear")

describe("integration detail update", () => {
	test("nothing is requested while the organization is unknown, or for an unknown provider", () => {
		const signedOut = storyUpdate(update, makeShared({ organization: null }))
		story(signedOut, given(linear), message(Message.ClickedConnect()), message(Message.ClickedDisconnect()), Command.expectNone())
		story(run, given(pageFor("figma-nope")), message(Message.ClickedConnect()), Command.expectNone())
	})

	test("config toggles add and remove their option", () => {
		story(
			run,
			given(linear),
			message(Message.ToggledConfigOption({ optionId: "auto-link", isSelected: true })),
			message(Message.ToggledConfigOption({ optionId: "notifications", isSelected: true })),
			message(Message.ToggledConfigOption({ optionId: "auto-link", isSelected: false })),
			model((current) => expect(current.enabledOptionIds).toEqual(["notifications"])),
		)
	})

	test("an API key form with a blank field sends nothing", () => {
		story(
			run,
			given({ ...pageFor("craft"), apiToken: "secret", apiBaseUrl: "   " }),
			message(Message.SubmittedApiKeyForm()),
			Command.expectNone(),
			model((current) => expect(current.isConnecting).toBe(false)),
		)
	})

	// Bug: ClickedConnect has no isConnecting guard, so a second press fetches a second OAuth URL.
	test.fails("a second Connect while connecting sends nothing", () => {
		story(run, given(linear), message(Message.ClickedConnect()), Command.resolve(GetOAuthUrl, Message.FailedGetOAuthUrl()))
		expect(update({ ...linear, isConnecting: true }, Message.ClickedConnect(), shared).commands ?? []).toHaveLength(0)
	})

	// Bug: ClickedDisconnect has no isDisconnecting guard, so a repeat sends a second disconnect.
	test.fails("a second Disconnect while disconnecting sends nothing", () => {
		story(run, given(linear), message(Message.ClickedDisconnect()), Command.resolve(Disconnect, Message.CompletedDisconnect({ toast: null })))
		expect(update({ ...linear, isDisconnecting: true }, Message.ClickedDisconnect(), shared).commands ?? []).toHaveLength(0)
	})

	// Bug: SubmittedApiKeyForm has no isConnecting guard; Enter in a field resubmits while connecting.
	test.fails("a second API key submit while connecting sends nothing", () => {
		const filled = { ...pageFor("craft"), apiToken: "secret", apiBaseUrl: "https://craft.test/api" }
		story(
			run,
			given(filled),
			message(Message.SubmittedApiKeyForm()),
			Command.expectExact(ConnectApiKey({ orgId: organizationId, provider: "craft", token: "secret", baseUrl: "https://craft.test/api" })),
			Command.resolve(ConnectApiKey, Message.SucceededConnectApiKey({ externalAccountName: null })),
		)
		expect(update({ ...filled, isConnecting: true }, Message.SubmittedApiKeyForm(), shared).commands ?? []).toHaveLength(0)
	})
})
