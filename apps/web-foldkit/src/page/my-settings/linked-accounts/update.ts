import { Option } from "effect"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../../ui/aria/interaction"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { embedInteraction } from "../shared"
import { DisconnectDiscord, StartDiscordLink } from "./command"
import { Message } from "./message"
import type { Model } from "./model"
import { linkedAccountsHref, type RouteOf } from "../../../route"

type Return = PageReturn<Model, Message>

export const interaction = embedInteraction<Model, Message>((message) =>
	Message.GotInteractionMessage({ message }),
)

const toastRequest = (intent: "success" | "error", title: string, description: string | null = null) => ({
	intent,
	title,
	description,
})
const toast = (intent: "success" | "error", title: string, description: string | null = null) =>
	PageOutMessage.RequestedToast({ toast: toastRequest(intent, title, description) })

type Route = RouteOf<"MySettingsLinkedAccounts">

/** The OAuth callback's `?connection_status=&provider=&error_code=`: clean the URL with the result toast. */
const linkResult = (model: Model, route: Route): Return => {
	const status = Option.getOrNull(route.connectionStatus)
	if (status === null || Option.getOrNull(route.provider) !== "discord") return { model }
	return {
		model,
		outMessage: PageOutMessage.RequestedNavigation({
			href: linkedAccountsHref(model.orgSlug),
			replace: true,
			toast:
				status === "success"
					? toastRequest("success", "Discord account linked")
					: toastRequest(
							"error",
							"Failed to link Discord account",
							Option.getOrNull(route.errorCode) ?? "Please try again.",
						),
		}),
	}
}

export const init = (route: Route): Return =>
	linkResult(
		{
			orgSlug: route.orgSlug,
			connection: null,
			isConnecting: false,
			isDisconnecting: false,
			interaction: Interaction.init(),
		},
		route,
	)

/** Same page, new search: a later callback redirect, or the cleaned URL (nothing to show). */
export const routeChanged = (model: Model, route: Route): Return => linkResult(model, route)

export const update = (model: Model, message: Message, shared: Shared): Return => {
	const orgId = shared.currentUser?.organizationId ?? null
	return Message.match<Return>(message, {
		UpdatedDiscordConnection: ({ connection }) => ({
			model: modifyFields(model, { connection: () => connection }),
		}),
		ClickedLinkDiscord: () =>
			orgId === null || model.isConnecting
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
			orgId === null || model.isDisconnecting
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
