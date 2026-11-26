/**
 * The native wire, v2 (`docs/hazel-ui.md`, "Native host and the wire"): one batch per flush, ops as
 * JSON tuples. Swift decodes the same shapes (`EffectUiSpike/Wire.swift`) and refuses another version.
 */

export const WIRE_VERSION = 2

export type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json }

/** Ids are the host's; 0 is the root container. A text node is `create` with tag `#text`. */
export type Op =
	| readonly ["create", id: number, tag: string]
	| readonly ["props", id: number, changed: { readonly [name: string]: Json }]
	| readonly ["text", id: number, text: string]
	| readonly ["insert", parent: number, id: number, before: number | null]
	| readonly ["remove", id: number]
	| readonly ["events", id: number, names: ReadonlyArray<string>]
	// Stubbed in G1: declared so Swift can decode them, never sent yet.
	| readonly ["detach", id: number]
	| readonly ["command", request: number, id: number, name: string, args: Json]

export interface Batch {
	readonly v: typeof WIRE_VERSION
	readonly seq: number
	readonly ops: ReadonlyArray<Op>
}

/** What Swift sends back: an event on a node, or (stubbed) a command's reply. */
export type Inbound =
	| { readonly kind: "fire"; readonly id: number; readonly event: string; readonly payload: Json; readonly seq: number }
	| { readonly kind: "reply"; readonly request: number; readonly result: Json }
