import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../../ui/aria/interaction"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { embedInteraction } from "../shared"
import { DisconnectDiscord, ReadLinkResult, ShowLinkResult, StartDiscordLink } from "./command"
import { Message } from "./message"
import type { Model } from "./model"
import type { RouteOf } from "../../../route"

type Return = PageReturn<Model, Message>

export const interaction = embedInteraction<Model, Message>((message) =>
	Message.GotInteractionMessage({ message }),
)

const toast = (intent: "success" | "error", title: string, description: string | null = null) =>
	PageOutMessage.RequestedToast({ toast: { intent, title, description } })

export const init = (route: RouteOf<"MySettingsLinkedAccounts">): Return => ({
	model: {
		orgSlug: route.orgSlug,
		connection: null,
		isConnecting: false,
		isDisconnecting: false,
		interaction: Interaction.init(),
	},
	commands: [ReadLinkResult({})],
})

export const update = (model: Model, message: Message, shared: Shared): Return => {
	const orgId = shared.currentUser?.organizationId ?? null
	return Message.match<Return>(message, {
		ReadLinkResult: ({ connectionStatus, provider, errorCode }) =>
			connectionStatus === null || provider !== "discord"
				? { model }
				: {
						model,
						commands: [ShowLinkResult({})],
						outMessage:
							connectionStatus === "success"
								? toast("success", "Discord account linked")
								: toast("error", "Failed to link Discord account", errorCode ?? "Please try again."),
					},
		ShowedLinkResult: () => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({
				href: `/${model.orgSlug}/my-settings/linked-accounts`,
				replace: true,
			}),
		}),
		UpdatedDiscordConnection: ({ connection }) => ({
			model: modifyFields(model, { connection: () => connection }),
		}),
		ClickedLinkDiscord: () =>
			orgId === null
				? { model }
				: {
						model: modifyFields(model, { isConnecting: () => true }),
						commands: [StartDiscordLink({ orgId })],
					},
		SucceededGetDiscordOAuthUrl: () => ({ model }),
		FailedGetDiscordOAuthUrl: () => ({
			model: modifyFields(model, { isConnecting: () => false }),
			outMessage: toast("error", "Failed to start Discord linking flow"),
		}),
		ClickedUnlinkDiscord: () =>
			orgId === null
				? { model }
				: {
						model: modifyFields(model, { isDisconnecting: () => true }),
						commands: [DisconnectDiscord({ orgId })],
					},
		SucceededDisconnectDiscord: () => ({
			model: modifyFields(model, { isDisconnecting: () => false }),
			outMessage: toast("success", "Discord account unlinked"),
		}),
		FailedDisconnectDiscord: () => ({
			model: modifyFields(model, { isDisconnecting: () => false }),
			outMessage: toast("error", "Failed to unlink Discord account"),
		}),
		GotInteractionMessage: ({ message: child }) => interaction.fold(model, child),
	})
}
