import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import * as Interaction from "../../../ui/aria/interaction"
import { AccountConnections, LinkedProvider } from "./model"

/** Why `integrations.getOAuthUrl` failed, beyond the shared reasons. */
export const LinkFailure = Schema.Union([Schema.Literal("UnsupportedProvider"), CommonReason])
export type LinkFailure = typeof LinkFailure.Type

/** Why `integrations.disconnect` failed, beyond the shared reasons. */
export const UnlinkFailure = Schema.Union([
	Schema.Literals(["NotConnected", "UnsupportedProvider"]),
	CommonReason,
])
export type UnlinkFailure = typeof UnlinkFailure.Type

export const Message = defineMessageUnion({
	UpdatedConnections: { connections: AccountConnections },
	ClickedLink: { provider: LinkedProvider },
	SucceededGetOAuthUrl: {},
	FailedGetOAuthUrl: { provider: LinkedProvider, reason: LinkFailure },
	ClickedUnlink: { provider: LinkedProvider },
	SucceededDisconnect: { provider: LinkedProvider },
	FailedDisconnect: { provider: LinkedProvider, reason: UnlinkFailure },
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type
