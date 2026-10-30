/**
 * The objects an RPC can run in (`infra/durable-object-sync-plan.md` §2, §4): one Durable Object
 * per organization, channel and user, or `directory` (the api Worker itself, over D1).
 */
import type { SyncSourceKind } from "@hazel/domain/sync"

export type ObjectKind = SyncSourceKind

/** An object instance: its kind and its DO name (the organization, channel or user id). */
export interface ObjectTarget {
	readonly kind: ObjectKind
	readonly id: string
}

/** Where an RPC runs. */
export type RpcTarget = ObjectTarget | { readonly kind: "directory" }

/** The namespace (class and binding) name of each kind on the api Worker. */
export const OBJECT_NAMESPACES = {
	org: "OrgObject",
	channel: "ChannelObject",
	user: "UserObject",
} as const satisfies Record<ObjectKind, string>

export const isObjectKind = (value: string): value is ObjectKind =>
	value === "org" || value === "channel" || value === "user"

/** `org:<id>`: an outbox row's `target`, and a span attribute. */
export const formatTarget = (target: RpcTarget): string =>
	target.kind === "directory" ? "directory" : `${target.kind}:${target.id}`

export const directoryTarget: RpcTarget = { kind: "directory" }
export const orgTarget = (id: string): ObjectTarget => ({ kind: "org", id })
export const channelTarget = (id: string): ObjectTarget => ({ kind: "channel", id })
export const userTarget = (id: string): ObjectTarget => ({ kind: "user", id })
