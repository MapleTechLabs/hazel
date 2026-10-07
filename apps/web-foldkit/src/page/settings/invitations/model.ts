import { Schema } from "effect"
import * as Menu from "../../../ui/menu"

export const Invitation = Schema.Struct({
	id: Schema.String,
	emailAddress: Schema.String,
	role: Schema.String,
	createdAtMs: Schema.Number,
})
export type Invitation = typeof Invitation.Type

export const RowMenu = Schema.Struct({ invitationId: Schema.String, menu: Menu.Model })
export type RowMenu = typeof RowMenu.Type

export const Model = Schema.Struct({
	invitations: Schema.Array(Invitation),
	menus: Schema.Array(RowMenu),
	revokingId: Schema.NullOr(Schema.String),
})
export type Model = typeof Model.Type
