/**
 * The object an RPC handler runs in (`OrgObject`, `ChannelObject`, `UserObject`). Absent on the
 * api Worker's directory path. Handlers read it to format the write position they return
 * (`generateTransactionId`) and to check a payload against the object they landed in.
 */
import type { SyncSourceKind } from "@hazel/domain/sync"
import { Context, Effect, Option } from "effect"

export interface CurrentObjectShape {
	readonly kind: SyncSourceKind
	/** The DO name: the organization, channel or user id. */
	readonly id: string
}

export class CurrentObject extends Context.Service<CurrentObject, CurrentObjectShape>()(
	"@hazel/backend/CurrentObject",
) {}

/** The current object, or `None` on the directory path. */
export const currentObject: Effect.Effect<Option.Option<CurrentObjectShape>> =
	Effect.serviceOption(CurrentObject)
