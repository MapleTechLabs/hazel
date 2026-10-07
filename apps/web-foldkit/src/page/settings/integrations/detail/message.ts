import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { ToastRequest } from "../../../../overlay/toasts"
import { Connection } from "../shared/connections"
import { CallbackStatus } from "./model"

export const Message = defineMessageUnion({
	CompletedReadOAuthCallback: { status: Schema.NullOr(CallbackStatus), errorCode: Schema.NullOr(Schema.String) },
	AcknowledgedOAuthCallback: {},
	UpdatedConnection: { connection: Schema.NullOr(Connection) },
	ClickedBack: {},
	ClickedConnect: {},
	SucceededGetOAuthUrl: { authorizationUrl: Schema.String },
	FailedGetOAuthUrl: {},
	CompletedRedirectToProvider: {},
	ClickedDisconnect: {},
	CompletedDisconnect: { toast: Schema.NullOr(ToastRequest) },
	ChangedApiToken: { value: Schema.String },
	ChangedApiBaseUrl: { value: Schema.String },
	SubmittedApiKeyForm: {},
	SucceededConnectApiKey: { externalAccountName: Schema.NullOr(Schema.String) },
	FailedConnectApiKey: { toast: ToastRequest },
	ToggledConfigOption: { optionId: Schema.String, isSelected: Schema.Boolean },
})
export type Message = typeof Message.Type
