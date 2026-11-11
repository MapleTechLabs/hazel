import { IntegrationRequestId, OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

export const IntegrationRequestStatus = S.Literals(["pending", "reviewed", "planned", "rejected"])
export type IntegrationRequestStatus = S.Schema.Type<typeof IntegrationRequestStatus>

class Model extends M.Class<Model>("IntegrationRequest")({
	id: M.Generated(IntegrationRequestId),
	organizationId: OrganizationId,
	requestedBy: UserId,
	integrationName: S.NonEmptyString,
	integrationUrl: S.NullOr(S.String),
	description: S.NullOr(S.String),
	status: IntegrationRequestStatus,
	createdAt: M.Generated(JsonDate),
	updatedAt: M.Generated(JsonDate),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
