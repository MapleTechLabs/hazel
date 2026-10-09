import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { Message as ClerkMountMessage } from "../auth/clerk-mount"
import { UserOrganization } from "./model"

export const Message = defineMessageUnion({
	UpdatedOrganizations: { organizations: Schema.Array(UserOrganization) },
	ClickedOrganization: { organization: UserOrganization },
	ClickedCreateNew: {},
	GotClerkMountMessage: { message: ClerkMountMessage },
})
export type Message = typeof Message.Type
