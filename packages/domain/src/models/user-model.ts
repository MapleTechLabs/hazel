import { UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import { UserThemeSettings } from "./theme-model"
import * as M from "./utils"
import { baseFields } from "./utils"

export const UserType = S.Literals(["user", "machine"])
export type UserType = S.Schema.Type<typeof UserType>

/**
 * Time in HH:MM format (00:00 - 23:59)
 */
export const TimeString = S.String.check(S.isPattern(/^([01]\d|2[0-3]):([0-5]\d)$/)).pipe(
	S.brand("TimeString"),
)
export type TimeString = S.Schema.Type<typeof TimeString>

/**
 * Schema for user settings stored in the database
 */
export const UserSettingsSchema = S.Struct({
	doNotDisturb: S.optional(S.Boolean),
	quietHoursStart: S.optional(TimeString),
	quietHoursEnd: S.optional(TimeString),
	showQuietHoursInStatus: S.optional(S.Boolean),
	theme: S.optional(UserThemeSettings),
})
export type UserSettings = S.Schema.Type<typeof UserSettingsSchema>

class Model extends M.Class<Model>("User")({
	id: M.Generated(UserId),
	externalId: M.Sensitive(S.String),
	email: M.Immutable(S.String),
	firstName: S.String,
	lastName: S.String,
	avatarUrl: S.NullishOr(S.NonEmptyString),
	userType: M.Immutable(UserType),
	settings: S.NullOr(UserSettingsSchema),
	isOnboarded: M.GeneratedByApp(S.Boolean),
	timezone: S.NullOr(S.String),
	...baseFields,
}) {}

export const { Insert, Update, Schema, Create, Patch, PatchPartial } = M.expose(Model)
export type Type = typeof Schema.Type
