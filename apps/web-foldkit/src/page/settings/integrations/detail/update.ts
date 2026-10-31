import type { T3CodeSharing } from "@hazel/domain/http"
import { Option, Schema } from "effect"
import { Update } from "foldkit"
import { allValid, Invalid, NotValidated, validate } from "foldkit/fieldValidation"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { getIntegrationById } from "~/lib/integrations/__data"
import { AppRoute, integrationRoute, type RouteOf } from "../../../../route"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { errorToast, errorToastOf, reasonToast, successToast } from "../../../../data/actions"
import * as ConfirmAction from "../../../shared/confirm-action"
import {
	ConnectApiKey,
	Disconnect,
	DisconnectT3Code,
	GetOAuthUrl,
	GetT3CodeLink,
	isProvider,
	RedirectToProvider,
	StartT3CodeConnect,
	UpdateT3CodeSharing,
} from "./command"
import { Message } from "./message"
import {
	Activity,
	apiBaseUrlRules,
	apiTokenRules,
	CallbackStatus,
	environmentUrlRules,
	type Model,
	T3CodeState,
} from "./model"

const callbackStatus = Schema.decodeUnknownOption(CallbackStatus)

type Return = PageReturn<Model, Message>

/** `getErrorMessageFromCode` */
const errorMessageFromCode = (errorCode: string | null): string =>
	errorCode === "denied"
		? "The sign-in was cancelled. Please try again."
		: errorCode === "token_exchange_failed"
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
			activity: Activity.Idle(),
			apiToken: NotValidated({ value: "" }),
			apiBaseUrl: NotValidated({ value: "" }),
			enabledOptionIds: [],
			t3Code: T3CodeState.Loading(),
			environmentUrl: NotValidated({ value: "" }),
			t3CodeMembers: [],
			memberSearch: "",
			sharingSave: "Idle",
			sharingRequestId: 0,
			mapleBotInstalled: false,
			disconnectConfirm: ConfirmAction.init("t3code-disconnect"),
		},
		route,
	)

/** Same page, new search: a later callback redirect, or the cleaned URL (nothing to show). */
export const routeChanged = (model: Model, route: Route): Return => oauthCallback(model, route)

const nameOf = (model: Model) => getIntegrationById(model.integrationId)?.name

const UNSUPPORTED_PROVIDER = {
	title: "Unsupported provider",
	description: "This integration provider is not supported.",
}

/** The OAuth callback redirect's `connection_status` and `error_code`: toast and clean the URL. */
const oauthCallback = (model: Model, route: Route): Return => {
	const status = Option.getOrNull(callbackStatus(Option.getOrNull(route.connectionStatus)))
	const name = nameOf(model)
	if (status === null || name === undefined) return { model }
	return {
		model: status === "success" ? { ...model, activity: Activity.Verifying() } : model,
		outMessage: PageOutMessage.RequestedNavigation({
			route: integrationRoute(model.orgSlug, model.integrationId),
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

const validateEnvironmentUrl = validate(environmentUrlRules)

/** The shown link, once loaded. */
const t3CodeLinkOf = (model: Model) => (model.t3Code._tag === "Loaded" ? model.t3Code.link : null)

const T3CODE_NOT_CONNECTED = {
	title: "T3 Code not linked",
	description: "Your T3 Code environment is already unlinked.",
}

/** Starts T3's sign-in for `environmentUrl`: the API registers Hazel with the environment first. */
const startT3CodeConnect = (model: Model, shared: Shared, environmentUrl: string): Return =>
	shared.organization === null || model.activity._tag !== "Idle"
		? { model }
		: {
				model: { ...model, activity: Activity.Connecting() },
				commands: [StartT3CodeConnect({ orgId: shared.organization.id, environmentUrl })],
			}

/** Shows `sharing` at once and saves it; only the latest request's result counts. */
const saveSharing = (model: Model, shared: Shared, sharing: T3CodeSharing): Return => {
	const link = t3CodeLinkOf(model)
	if (link === null || shared.organization === null) return { model }
	const requestId = model.sharingRequestId + 1
	return {
		model: {
			...model,
			t3Code: T3CodeState.Loaded({ link: { ...link, sharing } }),
			sharingSave: "Saving",
			sharingRequestId: requestId,
		},
		commands: [UpdateT3CodeSharing({ orgId: shared.organization.id, requestId, sharing })],
	}
}

const foldDisconnectConfirm = Update.foldChild({
	update: (confirm: ConfirmAction.Model<string>, message: ConfirmAction.Message) =>
		ConfirmAction.update(confirm, message),
	read: (model: Model) => Option.some(model.disconnectConfirm),
	write: (model: Model, disconnectConfirm: ConfirmAction.Model<string>): Model =>
		modifyFields(model, { disconnectConfirm: () => disconnectConfirm }),
	toParentMessage: (message: ConfirmAction.Message) => Message.GotDisconnectConfirmMessage({ message }),
})

const withDisconnectConfirm = (model: Model, disconnectConfirm: ConfirmAction.Model<string>): Model =>
	modifyFields(model, { disconnectConfirm: () => disconnectConfirm })

const validateApiToken = validate(apiTokenRules)
const validateApiBaseUrl = validate(apiBaseUrlRules)

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedMapleBotInstalled: ({ isInstalled }) => ({
			model: modifyFields(model, { mapleBotInstalled: () => isInstalled }),
		}),
		UpdatedConnection: ({ connection }) => ({
			model: {
				...model,
				connection,
				// Verified: a later disconnect shows Connect again, not "Verifying connection...".
				activity:
					model.activity._tag === "Verifying" && connection?.isActive === true
						? Activity.Idle()
						: model.activity,
			},
		}),
		ClickedBack: () => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({
				route: AppRoute.SettingsIntegrations({ orgSlug: model.orgSlug }),
				replace: false,
			}),
		}),
		ClickedConnect: () => {
			const target = targetOf(model, shared)
			return target === null || model.activity._tag !== "Idle"
				? { model }
				: { model: { ...model, activity: Activity.Connecting() }, commands: [GetOAuthUrl(target)] }
		},
		SucceededGetOAuthUrl: ({ authorizationUrl }) => ({
			model,
			commands: [RedirectToProvider({ authorizationUrl })],
		}),
		FailedGetOAuthUrl: ({ reason }) => ({
			model: { ...model, activity: Activity.Idle() },
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(failureMessage(reason, { UnsupportedProvider: UNSUPPORTED_PROVIDER })),
			}),
		}),
		CompletedRedirectToProvider: () => ({ model }),
		ClickedDisconnect: () => {
			const target = targetOf(model, shared)
			return target === null || model.activity._tag !== "Idle"
				? { model }
				: { model: { ...model, activity: Activity.Disconnecting() }, commands: [Disconnect(target)] }
		},
		SucceededDisconnect: () => ({ model: { ...model, activity: Activity.Idle() } }),
		FailedDisconnect: ({ reason }) => ({
			model: { ...model, activity: Activity.Idle() },
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotConnected: {
							title: "Integration not connected",
							description: "This integration is already disconnected.",
						},
						UnsupportedProvider: UNSUPPORTED_PROVIDER,
					}),
				),
			}),
		}),
		ChangedApiToken: ({ value }) => ({ model: { ...model, apiToken: validateApiToken(value) } }),
		ChangedApiBaseUrl: ({ value }) => ({ model: { ...model, apiBaseUrl: validateApiBaseUrl(value) } }),
		SubmittedApiKeyForm: () => {
			const target = targetOf(model, shared)
			if (target === null || model.activity._tag !== "Idle") return { model }
			const apiToken = validateApiToken(model.apiToken.value)
			const apiBaseUrl = validateApiBaseUrl(model.apiBaseUrl.value)
			const validated = { ...model, apiToken, apiBaseUrl }
			return allValid([
				[apiToken, apiTokenRules],
				[apiBaseUrl, apiBaseUrlRules],
			])
				? {
						model: { ...validated, activity: Activity.Connecting() },
						commands: [
							ConnectApiKey({
								...target,
								token: apiToken.value.trim(),
								baseUrl: apiBaseUrl.value.trim(),
							}),
						],
					}
				: { model: validated }
		},
		SucceededConnectApiKey: ({ externalAccountName }) => ({
			model: { ...model, activity: Activity.Idle() },
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast(
					`Connected to ${nameOf(model) ?? "integration"}`,
					`Connected as ${externalAccountName ?? "your space"}.`,
				),
			}),
		}),
		FailedConnectApiKey: ({ reason }) => ({
			model: { ...model, activity: Activity.Idle() },
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						InvalidApiKey: {
							title: "Invalid credentials",
							description: "Check the bearer token and base URL, then try again.",
						},
						UnsupportedProvider: {
							title: "Unsupported provider",
							description: "This integration does not support API key connections.",
						},
					}),
				),
			}),
		}),
		ToggledConfigOption: ({ optionId, isSelected }) => ({
			model: {
				...model,
				enabledOptionIds: isSelected
					? [...model.enabledOptionIds, optionId]
					: model.enabledOptionIds.filter((id) => id !== optionId),
			},
		}),
		// The link's row synced (first load, the sign-in landing, a disconnect elsewhere): refetch it.
		ChangedT3CodeRow: () =>
			shared.organization === null
				? { model }
				: { model, commands: [GetT3CodeLink({ orgId: shared.organization.id })] },
		SucceededGetT3CodeLink: ({ link }) => {
			// A sharing save in flight keeps showing what the member picked.
			const pendingSharing = model.sharingSave === "Saving" ? t3CodeLinkOf(model)?.sharing : undefined
			return {
				model: {
					...model,
					t3Code: T3CodeState.Loaded({
						link:
							link !== null && pendingSharing !== undefined
								? { ...link, sharing: pendingSharing }
								: link,
					}),
					activity:
						model.activity._tag === "Verifying" && link?.status === "active"
							? Activity.Idle()
							: model.activity,
				},
			}
		},
		FailedGetT3CodeLink: ({ reason }) =>
			model.t3Code._tag === "Loaded"
				? { model, outMessage: PageOutMessage.RequestedToast({ toast: reasonToast(reason) }) }
				: { model: { ...model, t3Code: T3CodeState.Failed() } },
		ClickedRetryT3CodeLink: () =>
			shared.organization === null
				? { model }
				: {
						model: { ...model, t3Code: T3CodeState.Loading() },
						commands: [GetT3CodeLink({ orgId: shared.organization.id })],
					},
		UpdatedT3CodeMembers: ({ members }) => ({ model: { ...model, t3CodeMembers: members } }),
		ChangedEnvironmentUrl: ({ value }) => ({
			model: { ...model, environmentUrl: validateEnvironmentUrl(value) },
		}),
		SubmittedEnvironmentForm: () => {
			const environmentUrl = validateEnvironmentUrl(model.environmentUrl.value)
			const validated = { ...model, environmentUrl }
			return allValid([[environmentUrl, environmentUrlRules]])
				? startT3CodeConnect(validated, shared, environmentUrl.value.trim())
				: { model: validated }
		},
		ClickedReconnectT3Code: () => {
			const link = t3CodeLinkOf(model)
			return link === null ? { model } : startT3CodeConnect(model, shared, link.environmentUrl)
		},
		// The address is not a T3 Code environment: say why under the input.
		RejectedT3CodeEnvironment: ({ message }) => ({
			model: {
				...model,
				activity: Activity.Idle(),
				environmentUrl:
					t3CodeLinkOf(model) === null
						? Invalid({ value: model.environmentUrl.value, errors: [message] })
						: model.environmentUrl,
			},
			// Reconnecting has no input to show it under.
			...(t3CodeLinkOf(model) === null
				? {}
				: {
						outMessage: PageOutMessage.RequestedToast({
							toast: errorToast("Could not reach your T3 Code environment", message),
						}),
					}),
		}),
		FailedStartT3CodeConnect: ({ reason }) => ({
			model: { ...model, activity: Activity.Idle() },
			outMessage: PageOutMessage.RequestedToast({ toast: reasonToast(reason) }),
		}),
		ChangedSharingMode: ({ mode }) => {
			const link = t3CodeLinkOf(model)
			return link === null || link.sharing.mode === mode
				? { model }
				: saveSharing(model, shared, { ...link.sharing, mode })
		},
		ToggledSharingMember: ({ userId, isSelected }) => {
			const link = t3CodeLinkOf(model)
			if (link === null) return { model }
			const others = link.sharing.userIds.filter((id) => id !== userId)
			return saveSharing(model, shared, {
				mode: "members",
				userIds: isSelected ? [...others, userId] : others,
			})
		},
		ChangedMemberSearch: ({ value }) => ({ model: { ...model, memberSearch: value } }),
		SucceededUpdateSharing: ({ requestId, link }) =>
			requestId !== model.sharingRequestId
				? { model }
				: { model: { ...model, t3Code: T3CodeState.Loaded({ link }), sharingSave: "Saved" } },
		// The latest save failed: toast and reload what the server holds.
		FailedUpdateSharing: ({ requestId, reason }) =>
			requestId !== model.sharingRequestId || shared.organization === null
				? { model }
				: {
						model: { ...model, sharingSave: "Idle" },
						commands: [GetT3CodeLink({ orgId: shared.organization.id })],
						outMessage: PageOutMessage.RequestedToast({
							toast: errorToastOf(
								failureMessage(reason, { NotConnected: T3CODE_NOT_CONNECTED }),
							),
						}),
					},
		ClickedDisconnectT3Code: () => {
			const link = t3CodeLinkOf(model)
			return link === null
				? { model }
				: {
						model: withDisconnectConfirm(
							model,
							ConfirmAction.ask(model.disconnectConfirm, link.environmentLabel),
						),
					}
		},
		ClickedConfirmDisconnectT3Code: () => {
			const organization = shared.organization
			if (organization === null) return { model }
			return Option.match(ConfirmAction.confirm(model.disconnectConfirm), {
				onNone: () => ({ model }),
				onSome: ([running]) => ({
					model: withDisconnectConfirm(model, running),
					commands: [DisconnectT3Code({ orgId: organization.id })],
				}),
			})
		},
		SucceededDisconnectT3Code: () => ({
			model: {
				...withDisconnectConfirm(model, ConfirmAction.close(model.disconnectConfirm)),
				t3Code: T3CodeState.Loaded({ link: null }),
				sharingSave: "Idle",
			},
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("T3 Code unlinked") }),
		}),
		FailedDisconnectT3Code: ({ reason }) => ({
			model: withDisconnectConfirm(model, ConfirmAction.failed(model.disconnectConfirm)),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(failureMessage(reason, { NotConnected: T3CODE_NOT_CONNECTED })),
			}),
		}),
		GotDisconnectConfirmMessage: ({ message: confirmMessage }) =>
			foldDisconnectConfirm(model, confirmMessage),
	})
