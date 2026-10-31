import { T3CodeSharingMode } from "@hazel/domain/http"
import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import * as ConfirmAction from "../../../shared/confirm-action"
import { Connection } from "../shared/connections"
import { T3CodeLink, T3CodeMember } from "./model"

/** What can go wrong fetching the OAuth URL, beyond the shared reasons. */
export const GetOAuthUrlFailure = Schema.Union([Schema.Literals(["UnsupportedProvider"]), CommonReason])
export type GetOAuthUrlFailure = typeof GetOAuthUrlFailure.Type

/** What can go wrong disconnecting, beyond the shared reasons. */
export const DisconnectFailure = Schema.Union([
	Schema.Literals(["NotConnected", "UnsupportedProvider"]),
	CommonReason,
])
export type DisconnectFailure = typeof DisconnectFailure.Type

/** What can go wrong connecting with an API key, beyond the shared reasons. */
export const ConnectApiKeyFailure = Schema.Union([
	Schema.Literals(["InvalidApiKey", "UnsupportedProvider"]),
	CommonReason,
])
export type ConnectApiKeyFailure = typeof ConnectApiKeyFailure.Type

/** What can go wrong changing T3 Code sharing or disconnecting it, beyond the shared reasons. */
export const T3CodeLinkFailure = Schema.Union([Schema.Literals(["NotConnected"]), CommonReason])
export type T3CodeLinkFailure = typeof T3CodeLinkFailure.Type

export const Message = defineMessageUnion({
	UpdatedConnection: { connection: Schema.NullOr(Connection) },
	UpdatedMapleBotInstalled: { isInstalled: Schema.Boolean },
	ClickedBack: {},
	ClickedConnect: {},
	SucceededGetOAuthUrl: { authorizationUrl: Schema.String },
	FailedGetOAuthUrl: { reason: GetOAuthUrlFailure },
	CompletedRedirectToProvider: {},
	ClickedDisconnect: {},
	SucceededDisconnect: {},
	FailedDisconnect: { reason: DisconnectFailure },
	ChangedApiToken: { value: Schema.String },
	ChangedApiBaseUrl: { value: Schema.String },
	SubmittedApiKeyForm: {},
	SucceededConnectApiKey: { externalAccountName: Schema.NullOr(Schema.String) },
	FailedConnectApiKey: { reason: ConnectApiKeyFailure },
	ToggledConfigOption: { optionId: Schema.String, isSelected: Schema.Boolean },
	ChangedT3CodeRow: {},
	SucceededGetT3CodeLink: { link: Schema.NullOr(T3CodeLink) },
	FailedGetT3CodeLink: { reason: CommonReason },
	ClickedRetryT3CodeLink: {},
	UpdatedT3CodeMembers: { members: Schema.Array(T3CodeMember) },
	ChangedEnvironmentUrl: { value: Schema.String },
	SubmittedEnvironmentForm: {},
	ClickedReconnectT3Code: {},
	RejectedT3CodeEnvironment: { message: Schema.String },
	FailedStartT3CodeConnect: { reason: CommonReason },
	ChangedSharingMode: { mode: T3CodeSharingMode },
	ToggledSharingMember: { userId: UserId, isSelected: Schema.Boolean },
	ChangedMemberSearch: { value: Schema.String },
	SucceededUpdateSharing: { requestId: Schema.Number, link: Schema.NullOr(T3CodeLink) },
	FailedUpdateSharing: { requestId: Schema.Number, reason: T3CodeLinkFailure },
	ClickedDisconnectT3Code: {},
	ClickedConfirmDisconnectT3Code: {},
	SucceededDisconnectT3Code: {},
	FailedDisconnectT3Code: { reason: T3CodeLinkFailure },
	GotDisconnectConfirmMessage: { message: ConfirmAction.Message },
})
export type Message = typeof Message.Type
