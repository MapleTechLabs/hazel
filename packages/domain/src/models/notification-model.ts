import { NotificationId, OrganizationMemberId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

class Model extends M.Class<Model>("Notification")({
	id: M.Generated(NotificationId),
	memberId: M.Immutable(OrganizationMemberId),
	targetedResourceId: M.Immutable(S.NullOr(S.String.check(S.isUUID()))),
	targetedResourceType: M.Immutable(S.NullOr(S.String)),
	resourceId: M.Immutable(S.NullOr(S.String.check(S.isUUID()))),
	resourceType: M.Immutable(S.NullOr(S.String)),
	createdAt: M.Generated(JsonDate),
	readAt: S.NullOr(JsonDate),
	/** Why it notifies (`NotificationReason`); null on rows from before reasons. */
	reason: M.GeneratedOptional(S.NullOr(S.String)),
	/** Do not disturb or quiet hours: counted and listed, but no sound or system notification. */
	silent: M.GeneratedOptional(S.Boolean),
}) {}

export const { Insert, Update, Schema, Create, Patch, PatchPartial } = M.expose(Model)
export type Type = typeof Schema.Type
