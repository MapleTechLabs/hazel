// The part of `bun:sqlite` the local cache uses (`local-cache-bun.ts`); see `bun-plugin.d.ts` for
// why Bun's own type package is not loaded.
declare module "bun:sqlite" {
	export class Statement {
		/** Runs the statement and answers its rows, each an object keyed by column name. */
		all(...params: Array<null | string | number | bigint | Uint8Array>): Array<unknown>
		finalize(): void
	}
	export class Database {
		constructor(
			path: string,
			options?: {
				create?: boolean
				readwrite?: boolean
				/** Integers come back as bigints, whatever their size. */
				safeIntegers?: boolean
			},
		)
		/** Compiles the first statement of `sql`; anything after it is ignored. */
		prepare(sql: string): Statement
		/** Runs every statement of `sql`. */
		run(sql: string): void
		close(): void
	}
}
