import { Option } from "effect"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { errorToast, successToast } from "../../../data/actions"
import * as Interaction from "../../../ui/aria/interaction"
import type { PageReturn, PageSubscriptionInput, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { DisconnectDiscord, StartDiscordLink } from "./command"
import { Message } from "./message"
import { Link, type Model } from "./model"
import { linkedAccountsRoute, type RouteOf } from "../../../route"

type Return = PageReturn<Model, Message>

export const interaction = Interaction.embed<Model, Message, PageSubscriptionInput<Model>>(
	(message) => Message.GotInteractionMessage({ message }),
	(input) => input.model,
)

type Route = RouteOf<"MySettingsLinkedAccounts">

/** The backend's OAuth callback `error_code`s (`OAuthErrorCode`), in words; anything else is a retry hint. */
const callbackErrorCopy: Readonly<Record<string, string>> = {
	token_exchange_failed: "Could not authenticate with Discord. Please try again.",
	account_info_failed: "Could not fetch your Discord account information.",
	db_error: "A database error occurred. Please try again.",
	encryption_error: "A security error occurred. Please try again.",
	invalid_state: "The link request expired. Please try again.",
}

const callbackErrorOf = (errorCode: Option.Option<string>): string =>
	Option.match(errorCode, {
		onNone: () => "Please try again.",
		onSome: (code) => callbackErrorCopy[code] ?? "Please try again.",
	})

/** The OAuth callback's `?connection_status=&provider=&error_code=`: clean the URL with the result toast. */
const linkResult = (model: Model, route: Route): Return => {
	const status = Option.getOrNull(route.connectionStatus)
	if (status === null || Option.getOrNull(route.provider) !== "discord") return { model }
	return {
		model,
		outMessage: PageOutMessage.RequestedNavigation({
			route: linkedAccountsRoute(model.orgSlug),
			replace: true,
			toast:
				status === "success"
					? successToast("Discord account linked")
					: errorToast("Failed to link Discord account", callbackErrorOf(route.errorCode)),
		}),
	}
}

export const init = (route: Route): Return =>
	linkResult(
		{
			orgSlug: route.orgSlug,
			connection: null,
			link: Link.Idle(),
			interaction: Interaction.init(),
		},
		route,
	)

/** Same page, new search: a later callback redirect, or the cleaned URL (nothing to show). */
export const routeChanged = (model: Model, route: Route): Return => linkResult(model, route)

const unsupported = {
	title: "Discord is not available",
	description: "Discord linking is not supported right now.",
}

export const update = (model: Model, message: Message, shared: Shared): Return => {
	const orgId = shared.organization?.id ?? null
	const isIdle = model.link._tag === "Idle"
	const toIdle = () => modifyFields(model, { link: () => Link.Idle() })
	return Message.match<Return>(message, {
		UpdatedDiscordConnection: ({ connection }) => ({
			model: modifyFields(model, { connection: () => connection }),
		}),
		ClickedLinkDiscord: () =>
			orgId === null || !isIdle
				? { model }
				: {
						model: modifyFields(model, { link: () => Link.Linking() }),
						commands: [StartDiscordLink({ orgId })],
					},
		// The page is navigating away; `Linking` keeps the button pending until it does.
		SucceededGetDiscordOAuthUrl: () => ({ model }),
		FailedGetDiscordOAuthUrl: ({ reason }) => ({
			model: toIdle(),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToast(
					"Failed to start Discord linking flow",
					failureMessage(reason, { UnsupportedProvider: unsupported }).description ?? null,
				),
			}),
		}),
		ClickedUnlinkDiscord: () =>
			orgId === null || !isIdle
				? { model }
				: {
						model: modifyFields(model, { link: () => Link.Unlinking() }),
						commands: [DisconnectDiscord({ orgId })],
					},
		SucceededDisconnectDiscord: () => ({
			model: toIdle(),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Discord account unlinked") }),
		}),
		FailedDisconnectDiscord: ({ reason }) => ({
			model: toIdle(),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToast(
					"Failed to unlink Discord account",
					failureMessage(reason, {
						NotConnected: {
							title: "Not linked",
							description: "This Discord account is no longer linked.",
						},
						UnsupportedProvider: unsupported,
					}).description ?? null,
				),
			}),
		}),
		GotInteractionMessage: ({ message: child }) => interaction.fold(model, child),
	})
}
