/**
 * A member's notification settings for a whole organization or one sidebar section
 * (`notification_overrides`, streamed to them alone): Discord's server and category settings.
 * Keyed by `userId`, `scope` and `scopeId`.
 */
import { OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import { NotificationLevel } from "./channel-member-model"
import { JsonDate } from "./utils"

export const Scope = S.Literals(["organization", "section"])
export type Scope = typeof Scope.Type

export const Schema = S.Struct({
	userId: UserId,
	organizationId: OrganizationId,
	scope: Scope,
	/** The organization's id, or the section's. */
	scopeId: S.String,
	level: S.NullOr(NotificationLevel),
	isMuted: S.Boolean,
	mutedUntil: S.NullOr(JsonDate),
	/** `@channel` and `@here` notify like any message (the organization's scope). */
	suppressEveryone: S.Boolean,
	updatedAt: JsonDate,
})
export type Type = typeof Schema.Type
