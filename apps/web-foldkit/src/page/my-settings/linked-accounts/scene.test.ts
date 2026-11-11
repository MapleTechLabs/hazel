// @vitest-environment jsdom
import { Option } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { makeShared, organizationId, pageScene } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { Disconnect, StartLink } from "./command"
import { Message } from "./message"
import { init, update } from "./update"
import { view } from "./view"

/** The linked accounts page through its view: the Discord card follows the live connection row. */

const shared = makeShared()
const route = {
	_tag: "MySettingsLinkedAccounts" as const,
	orgSlug: "hazel",
	connectionStatus: Option.none(),
	provider: Option.none(),
	errorCode: Option.none(),
}
const link = Scene.role("button", { name: "Link Discord" })
const unlink = Scene.role("button", { name: "Unlink" })
const active = Message.UpdatedConnections({
	connections: { discord: { status: "active", externalAccountName: "ada#1815" }, slack: null },
})

describe("discord card", () => {
	test("Link Discord shows Redirecting..., and a failure toasts and re-enables it", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(route).model),
			Scene.expect(unlink).toBeAbsent(),
			Scene.click(link),
			Scene.Command.expectExact(StartLink({ orgId: organizationId, provider: "discord" })),
			Scene.expect(Scene.role("button", { name: "Redirecting..." })).toBeDisabled(),
			Scene.Command.resolve(
				StartLink,
				Message.FailedGetOAuthUrl({ provider: "discord", reason: "Offline" }),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Failed to start Discord linking flow",
						description: "Check your internet connection and try again.",
					},
				}),
			),
			Scene.expect(link).toBeEnabled(),
		)
	})

	test("an active connection shows the linked account and Unlink", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(route).model),
			Scene.Subscription.emit(active),
			Scene.expect(Scene.text(/Linked as ada#1815\./)).toExist(),
			Scene.expect(link).toBeAbsent(),
			Scene.expect(unlink).toBeEnabled(),
		)
	})

	test("unlinking toasts, then the card returns to Link once the row is gone", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(route).model),
			Scene.Subscription.emit(active),
			Scene.click(unlink),
			Scene.Command.expectExact(Disconnect({ orgId: organizationId, provider: "discord" })),
			Scene.expect(Scene.role("button", { name: "Unlinking..." })).toBeDisabled(),
			Scene.Command.resolve(Disconnect, Message.SucceededDisconnect({ provider: "discord" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Discord account unlinked", description: null },
				}),
			),
			Scene.Subscription.emit(
				Message.UpdatedConnections({ connections: { discord: null, slack: null } }),
			),
			Scene.expect(link).toBeEnabled(),
		)
	})

	test("a failed unlink keeps the account linked with Unlink enabled", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(route).model),
			Scene.Subscription.emit(active),
			Scene.click(unlink),
			Scene.Command.resolve(
				Disconnect,
				Message.FailedDisconnect({ provider: "discord", reason: "NotConnected" }),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Failed to unlink Discord account",
						description: "This Discord account is no longer linked.",
					},
				}),
			),
			Scene.expect(unlink).toBeEnabled(),
			Scene.expect(Scene.text(/Linked as ada#1815\./)).toExist(),
		)
	})
})

describe("slack card", () => {
	const linkSlack = Scene.role("button", { name: "Link Slack" })

	test("Slack is offered next to Discord and links the same way", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(route).model),
			Scene.expect(Scene.text("Slack")).toExist(),
			Scene.expect(link).toBeEnabled(),
			Scene.click(linkSlack),
			Scene.Command.expectExact(StartLink({ orgId: organizationId, provider: "slack" })),
			Scene.expect(Scene.role("button", { name: "Redirecting..." })).toBeDisabled(),
			// One action at a time: Discord waits too.
			Scene.expect(link).toBeDisabled(),
			Scene.Command.resolve(
				StartLink,
				Message.FailedGetOAuthUrl({ provider: "slack", reason: "UnsupportedProvider" }),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Failed to start Slack linking flow",
						description: "Slack linking is not supported right now.",
					},
				}),
			),
			Scene.expect(linkSlack).toBeEnabled(),
		)
	})

	test("a linked Slack account shows its name and unlinks Slack", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(route).model),
			Scene.Subscription.emit(
				Message.UpdatedConnections({
					connections: { discord: null, slack: { status: "active", externalAccountName: "ada" } },
				}),
			),
			Scene.expect(Scene.text(/Linked as ada\. Synced Slack messages/)).toExist(),
			Scene.expect(link).toBeEnabled(),
			Scene.click(unlink),
			Scene.Command.expectExact(Disconnect({ orgId: organizationId, provider: "slack" })),
			Scene.Command.resolve(Disconnect, Message.SucceededDisconnect({ provider: "slack" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Slack account unlinked", description: null },
				}),
			),
		)
	})
})
