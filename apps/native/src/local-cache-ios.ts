/**
 * The local cache's databases on iOS: SQLite runs in the host (`host/ios/src/local_cache.rs`), and
 * each call crosses the bridge as one request and one reply, both JSON text.
 */
import type { BrowserWASQLiteDatabase } from "@tanstack/browser-db-sqlite-persistence"
import { type Bindable, type LocalCacheHost, toBindable } from "./local-cache"

/** A value on the wire: JSON's own, or an object for what JSON has no form for. */
type WireValue =
	| null
	| string
	| number
	/** An integer past 2^53, in decimal. */
	| { readonly i: string }
	/** A blob, in base64. */
	| { readonly b: string }
	/** `Infinity` or `-Infinity` (results only). */
	| { readonly f: string }

/** What the host is asked; `memory` keeps the database off the disk. */
export type CacheRequest =
	| { readonly open: string; readonly memory: boolean }
	| { readonly db: number; readonly sql: string; readonly params: ReadonlyArray<WireValue> }
	| { readonly close: number }
	| { readonly remove: string; readonly memory: boolean }

/** The host's answer: an error, a connection, or each statement's columns and rows. */
type CacheReply = {
	readonly error?: string
	readonly db?: number
	readonly sets?: ReadonlyArray<{
		readonly c: ReadonlyArray<string>
		readonly r: ReadonlyArray<ReadonlyArray<WireValue>>
	}>
}

const toBase64 = (bytes: Uint8Array) => {
	let binary = ""
	// In pieces: `fromCharCode` takes its arguments on the stack.
	for (let at = 0; at < bytes.length; at += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
	return btoa(binary)
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0))

const encodeParam = (value: Bindable): WireValue => {
	if (typeof value === "bigint") return { i: value.toString() }
	if (value instanceof Uint8Array) return { b: toBase64(value) }
	return value
}

const decodeValue = (value: WireValue): Bindable => {
	if (value === null || typeof value !== "object") return value
	if ("i" in value) return BigInt(value.i)
	if ("b" in value) return fromBase64(value.b)
	return value.f === "Infinity" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
}

/** A reply's text as what it carries; an error reply throws its message. */
const decodeReply = (text: string): CacheReply => {
	// SAFETY: the host's own reply (`Engine::answer`), whose shape the wire fixture holds both sides to.
	const reply = JSON.parse(text) as CacheReply
	if (reply.error !== undefined) throw new Error(reply.error)
	return reply
}

/** A reply's rows, each an object keyed by column name, as the OPFS worker answers. */
const rowsOf = (reply: CacheReply): Array<Record<string, unknown>> => {
	const rows: Array<Record<string, unknown>> = []
	for (const { c: columns, r: records } of reply.sets ?? []) {
		for (const record of records) {
			const row: Record<string, unknown> = {}
			for (let index = 0; index < columns.length; index++) {
				const column = columns[index]
				if (column) row[column] = decodeValue(record[index] ?? null)
			}
			rows.push(row)
		}
	}
	return rows
}

/**
 * `send` posts one request to the host and answers with its reply's text. `persist` false keeps
 * every database in memory (the offline fixture, which starts the same every time).
 */
export const makeIosLocalCache = (options: {
	readonly persist: boolean
	readonly send: (request: CacheRequest) => Promise<string>
}): LocalCacheHost => {
	const memory = !options.persist
	const ask = async (request: CacheRequest) => decodeReply(await options.send(request))
	return {
		open: async (databaseName) => {
			const { db } = await ask({ open: databaseName, memory })
			if (db === undefined) throw new Error("The host opened no database")
			const database: BrowserWASQLiteDatabase = {
				execute: async <TRow>(sql: string, params: ReadonlyArray<unknown> = []) => {
					const wire = params.map((param) => encodeParam(toBindable(param)))
					return rowsOf(await ask({ db, sql, params: wire })) as Array<TRow>
				},
				close: async () => {
					await ask({ close: db })
				},
			}
			return database
		},
		remove: async (databaseName) => {
			await ask({ remove: databaseName, memory })
		},
	}
}
