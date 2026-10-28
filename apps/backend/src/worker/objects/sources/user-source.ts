/** What a `UserObject` streams: the user's notifications, presence and organizations, to the user only. */
import type { Database } from "@hazel/db"
import { schema } from "@hazel/db"
import type { SyncSource } from "@hazel/sync-do"
import { Effect } from "effect"
import type { SyncPrincipal } from "../principal"
import { type SyncTableSpec, syncTable } from "./rows"

export const userSyncTables: ReadonlyArray<SyncTableSpec<SyncPrincipal>> = [
	{ table: schema.notificationsTable, visible: () => [] },
	{ table: schema.userPresenceStatusTable, visible: () => [] },
	{ table: schema.userOrganizationsTable, key: ["organizationId"], visible: () => [] },
]

/** `ownerId` is the object's id (the user), known once the object has learned it. */
export const makeUserSource = (
	ownerId: () => string | undefined,
): SyncSource<SyncPrincipal, never, Database.Database> => ({
	tables: userSyncTables.map(syncTable),
	authorize: (principal) => Effect.sync(() => principal.userId === ownerId()),
	principalId: (principal) => principal.userId,
	expiresAt: (principal) => principal.expiresAt,
})
