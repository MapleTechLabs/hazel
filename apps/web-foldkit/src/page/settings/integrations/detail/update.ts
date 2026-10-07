import { getIntegrationById } from "~/lib/integrations/__data"
import type { RouteOf } from "../../../../route"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { errorToast, successToast } from "../shared/exit-toast"
import {
	AcknowledgeOAuthCallback,
	ConnectApiKey,
	Disconnect,
	GetOAuthUrl,
	isProvider,
	ReadOAuthCallback,
	RedirectToProvider,
} from "./command"
import { Message } from "./message"
import type { Model } from "./model"

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

export const init = (route: RouteOf<"SettingsIntegration">): Return => ({
	model: {
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
	commands: [ReadOAuthCallback({})],
})

const nameOf = (model: Model) => getIntegrationById(model.integrationId)?.name

const toast = (model: Model, request: Parameters<typeof PageOutMessage.RequestedToast>[0]["toast"]) => ({
	model,
	outMessage: PageOutMessage.RequestedToast({ toast: request }),
})

/** The org and provider a request targets, or nothing while the organization is unknown. */
const targetOf = (model: Model, shared: Shared) =>
	shared.organization !== null && isProvider(model.integrationId)
		? { orgId: shared.organization.id, provider: model.integrationId }
		: null

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		CompletedReadOAuthCallback: ({ status, errorCode }) => {
			const name = nameOf(model)
			if (status === null || name === undefined) return { model }
			const next = { ...model, pendingVerification: model.pendingVerification || status === "success" }
			return {
				...toast(
					next,
					status === "success"
						? successToast(`Connected to ${name}`, "Your account has been successfully connected.")
						: errorToast(`Failed to connect to ${name}`, errorMessageFromCode(errorCode)),
				),
				commands: [AcknowledgeOAuthCallback({})],
			}
		},
		AcknowledgedOAuthCallback: () => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({
				href: `/${model.orgSlug}/settings/integrations/${model.integrationId}`,
				replace: true,
			}),
		}),
		UpdatedConnection: ({ connection }) => ({ model: { ...model, connection } }),
		ClickedBack: () => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({
				href: `/${model.orgSlug}/settings/integrations`,
				replace: false,
			}),
		}),
		ClickedConnect: () => {
			const target = targetOf(model, shared)
			return target === null
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
			return target === null
				? { model }
				: { model: { ...model, isDisconnecting: true }, commands: [Disconnect(target)] }
		},
		CompletedDisconnect: ({ toast: request }) => {
			const next = { ...model, isDisconnecting: false }
			return request === null ? { model: next } : toast(next, request)
		},
		ChangedApiToken: ({ value }) => ({ model: { ...model, apiToken: value } }),
		ChangedApiBaseUrl: ({ value }) => ({ model: { ...model, apiBaseUrl: value } }),
		SubmittedApiKeyForm: () => {
			const target = targetOf(model, shared)
			const token = model.apiToken.trim()
			const baseUrl = model.apiBaseUrl.trim()
			return target === null || !token || !baseUrl
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
