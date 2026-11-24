/**
 * Migrations are append-only (CLAUDE.md, "Schema changes"): every store is live, and each one
 * records the migrations it ran by id, so a committed migration edited, removed or reordered never
 * reaches the stores that already ran it. `scripts/check-migrations-append-only.ts` runs these on CI
 * against the pull request's base.
 */

export interface Migration {
	readonly id: string
	readonly statements: ReadonlyArray<string>
	readonly optional?: true
}

export type MigrationsByStore = Readonly<Record<string, ReadonlyArray<Migration>>>

const sameMigration = (a: Migration, b: Migration) =>
	a.id === b.id &&
	a.optional === b.optional &&
	a.statements.length === b.statements.length &&
	a.statements.every((statement, index) => statement === b.statements[index])

/**
 * Every store's migrations at the base must open its list at head, unchanged and in order; head
 * may only add after them (and add new stores).
 */
export const migrationViolations = (base: MigrationsByStore, head: MigrationsByStore): Array<string> => {
	const violations: Array<string> = []
	for (const [store, baseMigrations] of Object.entries(base)) {
		const headMigrations = head[store]
		if (headMigrations === undefined) {
			violations.push(`${store}: the store's migrations were removed`)
			continue
		}
		baseMigrations.forEach((migration, index) => {
			const at = headMigrations[index]
			if (at !== undefined && sameMigration(migration, at)) return
			const moved = headMigrations.find((candidate) => candidate.id === migration.id)
			violations.push(
				moved === undefined
					? `${store}/${migration.id}: removed`
					: !sameMigration(migration, moved)
						? `${store}/${migration.id}: modified`
						: `${store}/${migration.id}: moved (expected at position ${index + 1}, found ${at?.id ?? "nothing"} there)`,
			)
		})
	}
	return violations
}

/**
 * Committed migration files (`packages/db/migrations/directory/<NNNN>_<name>/migration.sql`, which
 * alchemy applies to D1 by name): each must still exist with the same content. Values are content
 * hashes (git blob ids); `undefined` at head means the file is gone.
 */
export const fileViolations = (
	base: ReadonlyMap<string, string>,
	head: ReadonlyMap<string, string | undefined>,
): Array<string> => {
	const violations: Array<string> = []
	for (const [path, hash] of base) {
		const now = head.get(path)
		if (now === undefined) violations.push(`${path}: removed`)
		else if (now !== hash) violations.push(`${path}: modified`)
	}
	// Applied in name order: a new one must sort after every committed one.
	const last = [...base.keys()].sort().at(-1)
	for (const [path, hash] of head) {
		if (hash !== undefined && !base.has(path) && last !== undefined && path < last) {
			violations.push(`${path}: added before ${last}; number it after the last committed migration`)
		}
	}
	return violations
}
