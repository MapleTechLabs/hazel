import { Option } from "effect"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { errorToast, successToast } from "../../../data/actions"
import * as Interaction from "../../../ui/aria/interaction"
import type { PageReturn, PageSubscriptionInput, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { Disconnect, StartLink } from "./command"
import { Message } from "./message"
import { isLinkedProvider, Link, type LinkedProvider, type Model, PROVIDER_LABELS } from "./model"
import { linkedAccountsRoute, type RouteOf } from "../../../route"

type Return = PageReturn<Model, Message>

export const interaction = Interaction.embed<Model, Message, PageSubscriptionInput<Model>>(
	(message) => Message.GotInteractionMessage({ message }),
	(input) => input.model,
)

type Route = RouteOf<"MySettingsLinkedAccounts">

/** The backend's OAuth callback `error_code`s (`OAuthErrorCode`), in words; anything else is a retry hint. */
const callbackErrorCopy = (name: string): Readonly<Record<string, string>> => ({
	token_exchange_failed: `Could not authenticate with ${name}. Please try again.`,
	account_info_failed: `Could not fetch your ${name} account information.`,
	db_error: "A database error occurred. Please try again.",
	encryption_error: "A security error occurred. Please try again.",
	invalid_state: "The link request expired. Please try again.",
})

const callbackErrorOf = (name: string, errorCode: Option.Option<string>): string =>
	Option.match(errorCode, {
		onNone: () => "Please try again.",
		onSome: (code) => callbackErrorCopy(name)[code] ?? "Please try again.",
	})

/** The OAuth callback's `?connection_status=&provider=&error_code=`: clean the URL with the result toast. */
const linkResult = (model: Model, route: Route): Return => {
	const status = Option.getOrNull(route.connectionStatus)
	const provider = Option.getOrNull(route.provider)
	if (status === null || provider === null || !isLinkedProvider(provider)) return { model }
	const { name } = PROVIDER_LABELS[provider]
	return {
		model,
		outMessage: PageOutMessage.RequestedNavigation({
			route: linkedAccountsRoute(model.orgSlug),
			replace: true,
			toast:
				status === "success"
					? successToast(`${name} account linked`)
					: errorToast(`Failed to link ${name} account`, callbackErrorOf(name, route.errorCode)),
		}),
	}
}

export const init = (route: Route): Return =>
	linkResult(
		{
			orgSlug: route.orgSlug,
			connections: { discord: null, slack: null },
			link: Link.Idle(),
			interaction: Interaction.init(),
		},
		route,
	)

/** Same page, new search: a later callback redirect, or the cleaned URL (nothing to show). */
export const routeChanged = (model: Model, route: Route): Return => linkResult(model, route)

const unsupported = (provider: LinkedProvider) => {
	const { name } = PROVIDER_LABELS[provider]
	return { title: `${name} is not available`, description: `${name} linking is not supported right now.` }
}

export const update = (model: Model, message: Message, shared: Shared): Return => {
	const orgId = shared.organization?.id ?? null
	const isIdle = model.link._tag === "Idle"
	const toIdle = () => modifyFields(model, { link: () => Link.Idle() })
	return Message.match<Return>(message, {
		UpdatedConnections: ({ connections }) => ({
			model: modifyFields(model, { connections: () => connections }),
		}),
		ClickedLink: ({ provider }) =>
			orgId === null || !isIdle
				? { model }
				: {
						model: modifyFields(model, { link: () => Link.Linking({ provider }) }),
						commands: [StartLink({ orgId, provider })],
					},
		// The page is navigating away; `Linking` keeps the button pending until it does.
		SucceededGetOAuthUrl: () => ({ model }),
		FailedGetOAuthUrl: ({ provider, reason }) => ({
			model: toIdle(),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToast(
					`Failed to start ${PROVIDER_LABELS[provider].name} linking flow`,
					failureMessage(reason, { UnsupportedProvider: unsupported(provider) }).description ??
						null,
				),
			}),
		}),
		ClickedUnlink: ({ provider }) =>
			orgId === null || !isIdle
				? { model }
				: {
						model: modifyFields(model, { link: () => Link.Unlinking({ provider }) }),
						commands: [Disconnect({ orgId, provider })],
					},
		SucceededDisconnect: ({ provider }) => ({
			model: toIdle(),
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast(`${PROVIDER_LABELS[provider].name} account unlinked`),
			}),
		}),
		FailedDisconnect: ({ provider, reason }) => {
			const { name } = PROVIDER_LABELS[provider]
			return {
				model: toIdle(),
				outMessage: PageOutMessage.RequestedToast({
					toast: errorToast(
						`Failed to unlink ${name} account`,
						failureMessage(reason, {
							NotConnected: {
								title: "Not linked",
								description: `This ${name} account is no longer linked.`,
							},
							UnsupportedProvider: unsupported(provider),
						}).description ?? null,
					),
				}),
			}
		},
		GotInteractionMessage: ({ message: child }) => interaction.fold(model, child),
	})
}
