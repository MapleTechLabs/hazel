import { Option, Schema } from "effect"
import { getIntegrationById } from "~/lib/integrations/__data"
import type { RouteOf } from "../../../../route"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { errorToast, successToast } from "../shared/exit-toast"
import { ConnectApiKey, Disconnect, GetOAuthUrl, isProvider, RedirectToProvider } from "./command"
import { Message } from "./message"
import { CallbackStatus, type Model } from "./model"

const callbackStatus = Schema.decodeUnknownOption(CallbackStatus)

type Return = PageReturn<Model, Message>

/** `getErrorMessageFromCode` */
const errorMessageFromCode = (errorCode: string | null): string =>
	errorCode === "token_exchange_failed"
		? "Could not authenticate with the provider. Please try again."
		: errorCode === "account_info_failed"
			? "Could not fetch your account information."
			: errorCode === "db_error"
				? "A database error occurred. Please try again."
				: errorCode === "encryption_error"
					? "A security error occurred. Please try again."
					: errorCode === "invalid_state"
						? "The connection request expired. Please try again."
						: "An unexpected error occurred. Please try again."

type Route = RouteOf<"SettingsIntegration">

export const init = (route: Route): Return =>
	oauthCallback(
		{
			orgSlug: route.orgSlug,
			integrationId: route.integrationId,
			connection: null,
			pendingVerification: false,
			isConnecting: false,
			isDisconnecting: false,
			apiToken: "",
			apiBaseUrl: "",
			enabledOptionIds: [],
		},
		route,
	)

/** Same page, new search: a later callback redirect, or the cleaned URL (nothing to show). */
export const routeChanged = (model: Model, route: Route): Return => oauthCallback(model, route)

const nameOf = (model: Model) => getIntegrationById(model.integrationId)?.name

const toast = (model: Model, request: Parameters<typeof PageOutMessage.RequestedToast>[0]["toast"]) => ({
	model,
	outMessage: PageOutMessage.RequestedToast({ toast: request }),
})

/** The OAuth callback redirect's `connection_status` and `error_code`: toast and clean the URL. */
const oauthCallback = (model: Model, route: Route): Return => {
	const status = Option.getOrNull(callbackStatus(Option.getOrNull(route.connectionStatus)))
	const name = nameOf(model)
	if (status === null || name === undefined) return { model }
	return {
		model: { ...model, pendingVerification: model.pendingVerification || status === "success" },
		outMessage: PageOutMessage.RequestedNavigation({
			href: `/${model.orgSlug}/settings/integrations/${model.integrationId}`,
			replace: true,
			toast:
				status === "success"
					? successToast(`Connected to ${name}`, "Your account has been successfully connected.")
					: errorToast(
							`Failed to connect to ${name}`,
							errorMessageFromCode(Option.getOrNull(route.errorCode)),
						),
		}),
	}
}

/** The org and provider a request targets, or nothing while the organization is unknown. */
const targetOf = (model: Model, shared: Shared) =>
	shared.organization !== null && isProvider(model.integrationId)
		? { orgId: shared.organization.id, provider: model.integrationId }
		: null

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedConnection: ({ connection }) => ({
			model: {
				...model,
				connection,
				// Verified: a later disconnect shows Connect again, not "Verifying connection...".
				pendingVerification: model.pendingVerification && connection?.isActive !== true,
			},
		}),
		ClickedBack: () => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({
				href: `/${model.orgSlug}/settings/integrations`,
				replace: false,
			}),
		}),
		ClickedConnect: () => {
			const target = targetOf(model, shared)
			return target === null || model.isConnecting
				? { model }
				: { model: { ...model, isConnecting: true }, commands: [GetOAuthUrl(target)] }
		},
		SucceededGetOAuthUrl: ({ authorizationUrl }) => ({
			model,
			commands: [RedirectToProvider({ authorizationUrl })],
		}),
		FailedGetOAuthUrl: () =>
			toast(
				{ ...model, isConnecting: false },
				errorToast(
					`Failed to connect to ${nameOf(model) ?? "integration"}`,
					"Could not initiate the connection. Please try again.",
				),
			),
		CompletedRedirectToProvider: () => ({ model }),
		ClickedDisconnect: () => {
			const target = targetOf(model, shared)
			return target === null || model.isDisconnecting
				? { model }
				: { model: { ...model, isDisconnecting: true }, commands: [Disconnect(target)] }
		},
		SucceededDisconnect: () => ({ model: { ...model, isDisconnecting: false } }),
		FailedDisconnect: ({ toast: request }) => toast({ ...model, isDisconnecting: false }, request),
		ChangedApiToken: ({ value }) => ({ model: { ...model, apiToken: value } }),
		ChangedApiBaseUrl: ({ value }) => ({ model: { ...model, apiBaseUrl: value } }),
		SubmittedApiKeyForm: () => {
			const target = targetOf(model, shared)
			const token = model.apiToken.trim()
			const baseUrl = model.apiBaseUrl.trim()
			return target === null || !token || !baseUrl || model.isConnecting
				? { model }
				: {
						model: { ...model, isConnecting: true },
						commands: [ConnectApiKey({ ...target, token, baseUrl })],
					}
		},
		SucceededConnectApiKey: ({ externalAccountName }) =>
			toast(
				{ ...model, isConnecting: false },
				successToast(
					`Connected to ${nameOf(model) ?? "integration"}`,
					`Connected as ${externalAccountName ?? "your space"}.`,
				),
			),
		FailedConnectApiKey: ({ toast: request }) => toast({ ...model, isConnecting: false }, request),
		ToggledConfigOption: ({ optionId, isSelected }) => ({
			model: {
				...model,
				enabledOptionIds: isSelected
					? [...model.enabledOptionIds, optionId]
					: model.enabledOptionIds.filter((id) => id !== optionId),
			},
		}),
	})
