import { OrganizationId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { readStored, writeStored } from "./storage"

/**
 * The organization last opened on this device, so `/` (opening the app) goes back to it. The root
 * redirect only uses it while the user is still a member; otherwise it falls back to any membership.
 */

const KEY = "hazel:last-organization"

export const readLastOrganization: Effect.Effect<OrganizationId | null> = readStored(
	KEY,
	OrganizationId,
).pipe(Effect.map(Option.getOrNull))

/** A store that is full or blocked only costs the next open its preferred organization. */
export const rememberLastOrganization = (organizationId: OrganizationId): Effect.Effect<void> =>
	writeStored(KEY, OrganizationId, organizationId).pipe(Effect.ignore)
