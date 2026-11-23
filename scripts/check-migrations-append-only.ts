/**
 * Fails when a migration committed at the base was modified, removed or reordered (migrations are
 * append-only: every store is live and runs each migration once, by id). Checks the entries of
 * `packages/db/src/migrations.generated.ts` and the files under `packages/db/migrations/directory/`
 * in the working tree against the merge base with `<base-ref>`. New migrations after the committed
 * ones are fine.
 *
 *   bun scripts/check-migrations-append-only.ts [<base-ref>]   (default: origin/main)
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
	fileViolations,
	migrationViolations,
	type MigrationsByStore,
} from "../packages/setup/src/migrations/append-only.ts"

const ROOT = resolve(import.meta.dir, "..")
const GENERATED = "packages/db/src/migrations.generated.ts"
const DIRECTORY = "packages/db/migrations/directory"

const git = (...args: Array<string>) => {
	const result = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" })
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`)
	}
	return result.stdout.toString()
}

/** The file only imports types, so Bun can load any version of it on its own. */
const loadMigrations = async (path: string): Promise<MigrationsByStore> => {
	const module = (await import(path)) as { generatedMigrations?: MigrationsByStore }
	if (module.generatedMigrations === undefined) throw new Error(`${path} exports no generatedMigrations`)
	return module.generatedMigrations
}

const main = async () => {
	const baseRef = process.argv[2] ?? "origin/main"
	// The merge base: migrations main gained after this branch forked are not this branch's to keep.
	const base = git("merge-base", baseRef, "HEAD").trim()
	console.log(`Checking migrations against ${baseRef} (merge base ${base.slice(0, 12)})`)

	const temp = mkdtempSync(join(tmpdir(), "hazel-migrations-"))
	let violations: Array<string>
	try {
		const basePath = join(temp, "migrations.generated.ts")
		writeFileSync(basePath, git("show", `${base}:${GENERATED}`))
		violations = migrationViolations(
			await loadMigrations(basePath),
			await loadMigrations(join(ROOT, GENERATED)),
		)
	} finally {
		rmSync(temp, { recursive: true, force: true })
	}

	// `<mode> blob <hash>\t<path>` per committed file.
	const baseFiles = new Map(
		git("ls-tree", "-r", base, "--", DIRECTORY)
			.split("\n")
			.filter(Boolean)
			.flatMap((line) => {
				const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line)
				return match ? [[match[2] ?? "", match[1] ?? ""] as const] : []
			}),
	)
	const headPaths = [...new Bun.Glob(`${DIRECTORY}/**/*`).scanSync({ cwd: ROOT })]
	const headFiles = new Map<string, string | undefined>(
		[...new Set([...baseFiles.keys(), ...headPaths])].map((path) => {
			return [path, existsSync(join(ROOT, path)) ? git("hash-object", "--", path).trim() : undefined]
		}),
	)
	violations.push(...fileViolations(baseFiles, headFiles))

	if (violations.length > 0) {
		console.error(
			`\nCommitted migrations changed (they are append-only: add a new migration instead, ` +
				`see CLAUDE.md "Schema changes"):\n${violations.map((v) => `  - ${v}`).join("\n")}`,
		)
		process.exit(1)
	}
	console.log("OK: committed migrations are unchanged")
}

await main()
