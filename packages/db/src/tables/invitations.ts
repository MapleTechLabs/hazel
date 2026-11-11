import { InvitationId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, timestamptz, typed, uuid, varchar } from "./columns"
import { organizationRoleEnum } from "./organizations"

/** Email links contain a random token; only its hash is stored. */
export const organizationInvitationsTable = SQLite.table("organization_invitations", {
	columns: {
		id: SQLite.column(uuid(InvitationId), { defaultExpr: randomUuid }),
		organizationId: uuid(OrganizationId),
		email: varchar(320),
		role: SQLite.column(organizationRoleEnum, { default: "member" }),
		tokenHash: SQLite.text,
		invitedBy: uuid(UserId),
		status: SQLite.column(typed<"pending" | "accepted" | "revoked">()(varchar(16)), {
			default: "pending",
		}),
		expiresAt: timestamptz,
		acceptedBy: SQLite.nullable(uuid(UserId)),
		acceptedAt: SQLite.nullable(timestamptz),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.uniqueIndex("organization_invitations_token_hash_idx", ["tokenHash"]),

		SQLite.index("organization_invitations_organization_id_idx", ["organizationId"]),
	],
})
export type OrganizationInvitation = SQLite.SelectRowOf<typeof organizationInvitationsTable>
export type NewOrganizationInvitation = SQLite.InsertRowOf<typeof organizationInvitationsTable>
