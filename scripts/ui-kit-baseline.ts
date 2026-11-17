#!/usr/bin/env bun
/**
 * Rewrites scripts/oxlint-plugins/ui-kit-baseline.json: the per-file counts the kit-first and token
 * lint rules (scripts/oxlint-plugins/hazel-ui.mjs) still tolerate. Run it after fixing violations;
 * lint reports a file whose count dropped until the baseline follows.
 *
 * The baseline only shrinks: an entry that would grow, or a new file, fails unless you pass
 * `--allow-increase` (for a rule landing, never for new code).
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Schema } from "effect"

const root = join(import.meta.dir, "..")
const baselineFile = join(root, "scripts/oxlint-plugins/ui-kit-baseline.json")
const allowIncrease = process.argv.includes("--allow-increase")

const RULES = [
	"no-arbitrary-radius",
	"no-arbitrary-text-size",
	"no-kit-styles-in-pages",
	"no-palette-color",
	"no-raw-color",
	"no-raw-control",
	"no-raw-heading",
	"no-raw-shadow",
	"no-transition-all",
	"no-unknown-color",
]

const lint = Bun.spawnSync(
	[
		"./node_modules/.bin/oxlint",
		"--disable-nested-config",
		"-c",
		".oxlintrc.json",
		"--format",
		"json",
		"apps/web-foldkit/src",
	],
	{ cwd: root, env: { ...process.env, HAZEL_UI_BASELINE: "off" }, stdout: "pipe", stderr: "inherit" },
)

const Report = Schema.Struct({
	diagnostics: Schema.Array(
		Schema.Struct({ code: Schema.optional(Schema.String), filename: Schema.String }),
	),
})
const Baseline = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Number))
type Baseline = typeof Baseline.Type

const { diagnostics } = Schema.decodeUnknownSync(Schema.fromJsonString(Report))(lint.stdout.toString())

const counts = new Map<string, Map<string, number>>(RULES.map((rule) => [rule, new Map()]))
for (const { code, filename } of diagnostics) {
	const rule = code?.match(/^hazel-ui\((.+)\)$/)?.[1]
	const files = rule === undefined ? undefined : counts.get(rule)
	if (files === undefined) continue
	files.set(filename, (files.get(filename) ?? 0) + 1)
}

const previous = Schema.decodeUnknownSync(Schema.fromJsonString(Baseline))(readFileSync(baselineFile, "utf8"))
const previousCount = (rule: string, file: string) => previous[rule]?.[file] ?? 0

const grew = RULES.flatMap((rule) =>
	[...(counts.get(rule) ?? new Map<string, number>())]
		.filter(([file, count]) => count > previousCount(rule, file))
		.map(([file, count]) => `  ${rule}  ${file}: ${previousCount(rule, file)} → ${count}`),
)
if (grew.length > 0 && !allowIncrease) {
	console.error(
		"These files gained UI-kit rule violations. Fix them (use the kit component or token the lint message names) instead of growing the baseline:\n",
	)
	for (const line of grew.slice(0, 40)) console.error(line)
	if (grew.length > 40) console.error(`  … and ${grew.length - 40} more`)
	process.exit(1)
}

const sorted: Baseline = Object.fromEntries(
	RULES.map((rule) => [
		rule,
		Object.fromEntries(
			[...(counts.get(rule) ?? new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b)),
		),
	]),
)
writeFileSync(baselineFile, `${JSON.stringify(sorted, null, "\t")}\n`)

const total = (baseline: Baseline) =>
	Object.values(baseline).reduce((sum, files) => sum + Object.values(files).reduce((a, b) => a + b, 0), 0)
console.log(`ui-kit baseline: ${total(previous)} → ${total(sorted)} tolerated violations`)
