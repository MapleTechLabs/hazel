import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { ToastRequest } from "../../../../overlay/toasts"
import { Connection } from "../shared/connections"

export const Message = defineMessageUnion({
	UpdatedConnection: { connection: Schema.NullOr(Connection) },
	ClickedBack: {},
	ClickedConnect: {},
	SucceededGetOAuthUrl: { authorizationUrl: Schema.String },
	FailedGetOAuthUrl: {},
	CompletedRedirectToProvider: {},
	ClickedDisconnect: {},
	SucceededDisconnect: {},
	FailedDisconnect: { toast: ToastRequest },
	ChangedApiToken: { value: Schema.String },
	ChangedApiBaseUrl: { value: Schema.String },
	SubmittedApiKeyForm: {},
	SucceededConnectApiKey: { externalAccountName: Schema.NullOr(Schema.String) },
	FailedConnectApiKey: { toast: ToastRequest },
	ToggledConfigOption: { optionId: Schema.String, isSelected: Schema.Boolean },
})
export type Message = typeof Message.Type
