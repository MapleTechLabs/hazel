import { BotId, BotInstallationId, OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { Generated, JsonDate } from "./utils"

class Model extends M.Class<Model>("BotInstallation")({
	id: M.Generated(BotInstallationId),
	botId: BotId,
	organizationId: OrganizationId,
	installedBy: UserId,
	installedAt: Generated(JsonDate),
	/** The region of the bot's service that redeemed the install (`BotGatewayRegion`); `null` for the default. */
	region: M.GeneratedOptional(S.NullOr(S.String)),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
