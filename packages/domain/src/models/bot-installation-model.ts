import { BotId, BotInstallationId, OrganizationId, UserId } from "@hazel/schema"
import * as M from "./utils"
import { Generated, JsonDate } from "./utils"

class Model extends M.Class<Model>("BotInstallation")({
	id: M.Generated(BotInstallationId),
	botId: BotId,
	organizationId: OrganizationId,
	installedBy: UserId,
	installedAt: Generated(JsonDate),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
