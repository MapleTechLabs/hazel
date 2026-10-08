// @vitest-environment jsdom
import { Option } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { currentUser, makeShared, organizationId, storyUpdate } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { DisconnectDiscord, StartDiscordLink } from "./command"
import { Message } from "./message"
import type { Model } from "./model"
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
const linked = () => ({ ...initial(), connection: { status: "active", externalAccountName: "ada#1815" } })
const toast = (intent: "success" | "error", title: string) =>
	PageOutMessage.RequestedToast({ toast: { intent, title, description: null } })

describe("link discord", () => {
	test("linking starts the OAuth redirect for the user's organization", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, shared),
			given(initial()),
			message(Message.ClickedLinkDiscord()),
			Command.expectExact(StartDiscordLink({ orgId: organizationId })),
			model((current) => expect(current.isConnecting).toBe(true)),
			Command.resolve(StartDiscordLink, Message.SucceededGetDiscordOAuthUrl()),
			expectNoOutMessage(),
			model((current) => expect(current.isConnecting).toBe(true)),
		)
	})

	test("a failed OAuth URL clears the spinner and toasts", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, shared),
			given(initial()),
			message(Message.ClickedLinkDiscord()),
			Command.resolve(StartDiscordLink, Message.FailedGetDiscordOAuthUrl()),
			expectOutMessage(toast("error", "Failed to start Discord linking flow")),
			model((current) => expect(current.isConnecting).toBe(false)),
		)
	})

	test("without an organization nothing starts", () => {
		const orphan = makeShared({ currentUser: { ...currentUser, organizationId: null } })
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, orphan),
			given(initial()),
			message(Message.ClickedLinkDiscord()),
			Command.expectNone(),
		)
	})

	// ClickedLinkDiscord is guarded on isConnecting in update, not only by the disabled button.
	test("a second link click while redirecting is ignored", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, shared),
			given({ ...initial(), isConnecting: true }),
			message(Message.ClickedLinkDiscord()),
			Command.expectNone(),
		)
	})
})

describe("unlink discord", () => {
	test("unlinking toasts success and clears the pending state", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, shared),
			given(linked()),
			message(Message.ClickedUnlinkDiscord()),
			Command.expectExact(DisconnectDiscord({ orgId: organizationId })),
			model((current) => expect(current.isDisconnecting).toBe(true)),
			Command.resolve(DisconnectDiscord, Message.SucceededDisconnectDiscord()),
			expectOutMessage(toast("success", "Discord account unlinked")),
			model((current) => expect(current.isDisconnecting).toBe(false)),
		)
	})

	test("a failed unlink toasts and keeps the connection", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, shared),
			given(linked()),
			message(Message.ClickedUnlinkDiscord()),
			Command.resolve(DisconnectDiscord, Message.FailedDisconnectDiscord()),
			expectOutMessage(toast("error", "Failed to unlink Discord account")),
			model((current) => {
				expect(current.isDisconnecting).toBe(false)
				expect(current.connection?.status).toBe("active")
			}),
		)
	})

	// ClickedUnlinkDiscord is guarded on isDisconnecting in update, not only by the disabled button.
	test("a second unlink click while one is pending is ignored", () => {
		story<Model, Message, PageOutMessage>(
			storyUpdate(update, shared),
			given({ ...linked(), isDisconnecting: true }),
			message(Message.ClickedUnlinkDiscord()),
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
				href: "/hazel/my-settings/linked-accounts",
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
			toast: { intent: "error", title: "Failed to link Discord account", description: "Please try again." },
		})
	})
})
