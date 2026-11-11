import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as CreateWorkspace from "../create-workspace"
import { UserOrganization } from "./model"

export const Message = defineMessageUnion({
	UpdatedOrganizations: { organizations: Schema.Array(UserOrganization) },
	ClickedOrganization: { organization: UserOrganization },
	ClickedCreateNew: {},
	GotCreateWorkspaceMessage: { message: CreateWorkspace.Message },
})
export type Message = typeof Message.Type
