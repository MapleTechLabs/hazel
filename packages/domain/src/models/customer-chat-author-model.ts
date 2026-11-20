/**
 * An author of the org's channels linked to customers, as the `OrgObject` holds them
 * (`customer_chat_authors`, `docs/customers/author-side.md`): their side, why, and a member's
 * override. Synced to the org's members, never to Connect guests. Keyed by `userId`.
 */
import { OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import { AuthorSide, AuthorSideOverride, AuthorSideReason, ExternalWorkspace } from "../customers/author-side"
import { JsonDate } from "./utils"

export const Schema = S.Struct({
	userId: UserId,
	organizationId: OrganizationId,
	side: AuthorSide,
	reason: AuthorSideReason,
	override: S.NullOr(AuthorSideOverride),
	overrideBy: S.NullOr(UserId),
	overrideAt: S.NullOr(JsonDate),
	externalWorkspace: S.NullOr(ExternalWorkspace),
	updatedAt: JsonDate,
})
export type Type = typeof Schema.Type
