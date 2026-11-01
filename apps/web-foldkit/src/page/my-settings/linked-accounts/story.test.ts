// @vitest-environment jsdom
import { routeOfPath } from "../../../route"
import { Option } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { makeShared, organizationId, storyUpdate } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { Disconnect, StartLink } from "./command"
import { Message } from "./message"
import { Link, type Model } from "./model"
import { init, update } from "./update"

/** Update-loop tests for the Discord link and unlink actions and the callback URL cleanup. */

const shared = makeShared()
const route = {
	_tag: "MySettingsLinkedAccounts" as const,
	orgSlug: "hazel",
	connectionStatus: Option.none(),
	provider: Option.none(),
	errorCode: Option.none(),
}
const initial = () => init(route).model
const linked = () => ({
	...initial(),
	connections: { discord: { status: "active" as const, externalAccountName: "ada#1815" }, slack: null },
})
const toast = (intent: "success" | "error", title: string, description: string | null = null) =>
	PageOutMessage.RequestedToast({ toast: { intent, title, description } })

describe("link discord", () => {
	test("linking starts the OAuth redirect for the user's organization", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, shared),
			given(initial()),
			message(Message.ClickedLink({ provider: "discord" })),
			Command.expectExact(StartLink({ orgId: organizationId, provider: "discord" })),
			model((current) => expect(current.link).toEqual(Link.Linking({ provider: "discord" }))),
			Command.resolve(StartLink, Message.SucceededGetOAuthUrl()),
			expectNoOutMessage(),
			model((current) => expect(current.link).toEqual(Link.Linking({ provider: "discord" }))),
		)
	})

	test("a failed OAuth URL clears the spinner and toasts", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, shared),
			given(initial()),
			message(Message.ClickedLink({ provider: "discord" })),
			Command.resolve(
				StartLink,
				Message.FailedGetOAuthUrl({ provider: "discord", reason: "UnsupportedProvider" }),
			),
			expectOutMessage(
				toast(
					"error",
					"Failed to start Discord linking flow",
					"Discord linking is not supported right now.",
				),
			),
			model((current) => expect(current.link).toEqual(Link.Idle())),
		)
	})

	test("without an organization nothing starts", () => {
		const orphan = makeShared({ organization: null })
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, orphan),
			given(initial()),
			message(Message.ClickedLink({ provider: "discord" })),
			Command.expectNone(),
		)
	})

	// ClickedLink is guarded on isConnecting in update, not only by the disabled button.
	test("a second link click while redirecting is ignored", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, shared),
			given({ ...initial(), link: Link.Linking({ provider: "discord" }) }),
			message(Message.ClickedLink({ provider: "discord" })),
			Command.expectNone(),
		)
	})
})

describe("unlink discord", () => {
	test("unlinking toasts success and clears the pending state", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, shared),
			given(linked()),
			message(Message.ClickedUnlink({ provider: "discord" })),
			Command.expectExact(Disconnect({ orgId: organizationId, provider: "discord" })),
			model((current) => expect(current.link).toEqual(Link.Unlinking({ provider: "discord" }))),
			Command.resolve(Disconnect, Message.SucceededDisconnect({ provider: "discord" })),
			expectOutMessage(toast("success", "Discord account unlinked")),
			model((current) => expect(current.link).toEqual(Link.Idle())),
		)
	})

	test("a failed unlink toasts and keeps the connection", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, shared),
			given(linked()),
			message(Message.ClickedUnlink({ provider: "discord" })),
			Command.resolve(Disconnect, Message.FailedDisconnect({ provider: "discord", reason: "Timeout" })),
			expectOutMessage(
				toast(
					"error",
					"Failed to unlink Discord account",
					"The server is taking too long to respond. Please try again.",
				),
			),
			model((current) => {
				expect(current.link).toEqual(Link.Idle())
				expect(current.connections.discord?.status).toBe("active")
			}),
		)
	})

	// ClickedUnlink is guarded on isDisconnecting in update, not only by the disabled button.
	test("a second unlink click while one is pending is ignored", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, shared),
			given({ ...linked(), link: Link.Unlinking({ provider: "discord" }) }),
			message(Message.ClickedUnlink({ provider: "discord" })),
			Command.expectNone(),
		)
	})
})

describe("link callback", () => {
	test("the result toast rides the navigation that replaces the URL with the clean page path", () => {
		const callback = init({
			...route,
			connectionStatus: Option.some("success"),
			provider: Option.some("discord"),
		})
		expect(callback.commands).toBeUndefined()
		expect(callback.outMessage).toEqual(
			PageOutMessage.RequestedNavigation({
				route: routeOfPath("/hazel/my-settings/linked-accounts"),
				replace: true,
				toast: { intent: "success", title: "Discord account linked", description: null },
			}),
		)
	})

	test("an error callback without a code falls back to a retry hint", () => {
		const callback = init({
			...route,
			connectionStatus: Option.some("error"),
			provider: Option.some("discord"),
		})
		expect(callback.outMessage).toMatchObject({
			toast: {
				intent: "error",
				title: "Failed to link Discord account",
				description: "Please try again.",
			},
		})
	})
})
