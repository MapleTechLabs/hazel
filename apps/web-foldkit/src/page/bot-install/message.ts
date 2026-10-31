import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { ApproveFailure, BotSummary, InstallTarget } from "./model"

export const Message = defineMessageUnion({
	SucceededFetchRequest: { bot: BotSummary },
	FoundInvalidRequest: {},
	FailedFetchRequest: { reason: CommonReason },
	ClickedRetryRequest: {},
	UpdatedTargets: { targets: Schema.Array(InstallTarget) },
	SelectedOrganization: { organizationId: OrganizationId },
	ClickedSignIn: {},
	ClickedApprove: {},
	ClickedCancel: {},
	FailedApprove: { reason: ApproveFailure },
	/** The browser is loading the redirect or sign-in. */
	LeftPage: {},
})
export type Message = typeof Message.Type
