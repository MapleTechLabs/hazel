/**
 * What both runtimes' local cache hosts share (`local-cache-bun.ts`, `local-cache-ios.ts`): which
 * names are a database's, the values SQLite takes as parameters, and where one statement of a
 * script ends. Each host answers as wa-sqlite's OPFS worker does for the web app
 * (`@tanstack/browser-db-sqlite-persistence`), which the persistence was written against.
 */
export type { LocalCacheHost } from "../../web-foldkit/src/core/db/local-cache-host"

/** A value SQLite binds as it is. */
export type Bindable = null | string | number | bigint | Uint8Array

const DATABASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.sqlite$/

/**
 * `name` as a file's name in the cache's folder: letters, digits, `.`, `_` and `-`, ending
 * `.sqlite`. The name comes from the app (it holds a user's id), so it must not reach another
 * folder or another of the app's files. The iOS host checks the same (`host/ios/src/local_cache.rs`).
 */
export const databaseFileName = (name: string): string => {
	if (!DATABASE_NAME.test(name)) throw new Error(`"${name}" is no local cache database name`)
	return name
}

/** A parameter as SQLite binds it, converted as the OPFS worker converts one. */
export const toBindable = (value: unknown): Bindable => {
	if (value === null || value === undefined) return null
	if (typeof value === "string" || typeof value === "bigint" || value instanceof Uint8Array) return value
	if (typeof value === "number") return Number.isFinite(value) ? value : null
	if (typeof value === "boolean") return value ? 1 : 0
	if (value instanceof Date) return value.toISOString()
	if (Array.isArray(value) && value.every((entry) => typeof entry === "number" && Number.isFinite(entry)))
		return Uint8Array.from(value)
	throw new Error("Unsupported parameter type for a SQLite binding")
}

const isSpace = (char: string) =>
	char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f"
const isWordChar = (char: string) => /[A-Za-z0-9_$]/.test(char) || char > "\u007f"

/**
 * The statements of `sql`, each without its `;`, as SQLite itself splits a script
 * (`sqlite3_complete`): a `;` inside a string, a quoted name or a comment ends nothing, and a
 * `CREATE TRIGGER` runs to the `;` after its `END`. Text with no statement in it (space, comments)
 * is left out.
 */
export const splitStatements = (sql: string): Array<string> => {
	const statements: Array<string> = []
	let start = 0
	/** The words of the statement so far, lowercased: the first four, and the latest. */
	let words: Array<string> = []
	let lastWord = ""
	let hasToken = false
	const isTrigger = () => {
		const [first, second, third] = words
		if (first !== "create") return false
		return second === "trigger" || ((second === "temp" || second === "temporary") && third === "trigger")
	}
	const end = (at: number) => {
		if (hasToken) statements.push(sql.slice(start, at))
		start = at + 1
		words = []
		lastWord = ""
		hasToken = false
	}
	let at = 0
	while (at < sql.length) {
		const char = sql.charAt(at)
		const next = sql.charAt(at + 1)
		if (isSpace(char)) {
			at++
		} else if (char === "-" && next === "-") {
			const newline = sql.indexOf("\n", at)
			at = newline === -1 ? sql.length : newline + 1
		} else if (char === "/" && next === "*") {
			const close = sql.indexOf("*/", at + 2)
			at = close === -1 ? sql.length : close + 2
		} else if (char === ";") {
			// A trigger's body holds statements of its own: only the `;` after `END` ends it.
			if (isTrigger() && lastWord !== "end") {
				lastWord = ""
				at++
			} else {
				end(at)
				at++
			}
		} else if (char === "'" || char === '"' || char === "`" || char === "[") {
			const close = char === "[" ? "]" : char
			let cursor = at + 1
			// A doubled quote is the quote itself, inside the string.
			while (cursor < sql.length) {
				if (sql[cursor] !== close) cursor++
				else if (close !== "]" && sql[cursor + 1] === close) cursor += 2
				else break
			}
			hasToken = true
			lastWord = ""
			at = cursor + 1
		} else if (isWordChar(char)) {
			let cursor = at + 1
			while (cursor < sql.length && isWordChar(sql.charAt(cursor))) cursor++
			lastWord = sql.slice(at, cursor).toLowerCase()
			if (words.length < 3) words.push(lastWord)
			hasToken = true
			at = cursor
		} else {
			hasToken = true
			lastWord = ""
			at++
		}
	}
	end(sql.length)
	return statements
}
