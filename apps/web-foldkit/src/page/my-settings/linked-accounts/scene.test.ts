// @vitest-environment jsdom
import { Option } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { makeShared, organizationId, pageScene } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { DisconnectDiscord, StartDiscordLink } from "./command"
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
const active = Message.UpdatedDiscordConnection({
	connection: { status: "active", externalAccountName: "ada#1815" },
})

describe("discord card", () => {
	test("Link Discord shows Redirecting..., and a failure toasts and re-enables it", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(route).model),
			Scene.expect(unlink).toBeAbsent(),
			Scene.click(link),
			Scene.Command.expectExact(StartDiscordLink({ orgId: organizationId })),
			Scene.expect(Scene.role("button", { name: "Redirecting..." })).toBeDisabled(),
			Scene.Command.resolve(StartDiscordLink, Message.FailedGetDiscordOAuthUrl()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Failed to start Discord linking flow",
						description: null,
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
			Scene.Command.expectExact(DisconnectDiscord({ orgId: organizationId })),
			Scene.expect(Scene.role("button", { name: "Unlinking..." })).toBeDisabled(),
			Scene.Command.resolve(DisconnectDiscord, Message.SucceededDisconnectDiscord()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Discord account unlinked", description: null },
				}),
			),
			Scene.Subscription.emit(Message.UpdatedDiscordConnection({ connection: null })),
			Scene.expect(link).toBeEnabled(),
		)
	})

	test("a failed unlink keeps the account linked with Unlink enabled", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(route).model),
			Scene.Subscription.emit(active),
			Scene.click(unlink),
			Scene.Command.resolve(DisconnectDiscord, Message.FailedDisconnectDiscord()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Failed to unlink Discord account", description: null },
				}),
			),
			Scene.expect(unlink).toBeEnabled(),
			Scene.expect(Scene.text(/Linked as ada#1815\./)).toExist(),
		)
	})
})
