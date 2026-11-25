/**
 * User groups (`user_groups`, `user_group_members`): Discord's mentionable roles. An organization's
 * owners and admins name a group of members; `@[group:<id>]` mentions each of them. Streamed to the
 * organization's members.
 */
import { OrganizationId, UserGroupId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import { JsonDate } from "./utils"

/** Longest handle; matches the column (`varchar(64)`). */
export const HANDLE_MAX = 64
export const NAME_MAX = 100
export const DESCRIPTION_MAX = 500

/** Lowercase letters, digits, `-` and `_`, starting with a letter or digit. */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

/** A handle as typed, made into one: lowercased, spaces to `-`, other characters dropped. */
export const toHandle = (text: string) =>
	text
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9_-]/g, "")
		.replace(/^[-_]+/, "")
		.slice(0, HANDLE_MAX)

/** Handles a group cannot take: the mention directives. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set(["channel", "here", "everyone"])

export const Schema = S.Struct({
	id: UserGroupId,
	organizationId: OrganizationId,
	handle: S.String,
	name: S.String,
	description: S.NullOr(S.String),
	createdBy: UserId,
	createdAt: JsonDate,
	updatedAt: JsonDate,
	deletedAt: S.NullOr(JsonDate),
})
export type Type = typeof Schema.Type

export const MemberSchema = S.Struct({
	groupId: UserGroupId,
	userId: UserId,
	addedAt: JsonDate,
})
export type Member = typeof MemberSchema.Type
