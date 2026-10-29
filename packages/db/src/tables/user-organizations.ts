import { OrganizationId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { timestamptz, uuid } from "./columns"

/** A `UserObject`'s organizations: which `OrgObject`s its client opens. */
export const userOrganizationsTable = SQLite.table("user_organizations", {
	columns: {
		organizationId: uuid(OrganizationId),
		joinedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["organizationId"],
})
export type UserOrganization = SQLite.SelectRowOf<typeof userOrganizationsTable>
