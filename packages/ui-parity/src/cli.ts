import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { chromium } from "playwright"
import { startFixtureBackend } from "./backend/server.ts"
import { buildTarget } from "./build.ts"
import {
	BROWSER_LAUNCH_OPTIONS,
	captureDir,
	captureTarget,
	expandVariants,
	type CaptureResult,
} from "./capture.ts"
import { codegenFile } from "./codegen.ts"
import { compareVariant } from "./compare.ts"
import { clerkIdentityFor } from "./fixtures/identity.ts"
import { uncoveredRoutes } from "./coverage.ts"
import {
	BUILD_STAMP_FILE,
	buildDir,
	FIXTURE_BACKEND_PORT,
	FIXTURE_ELECTRIC_PORT,
	outDir,
	PORT_BASE,
	targets,
	type TargetName,
} from "./config.ts"
import { buildSummary, writeReport } from "./report.ts"
import { datasets } from "./scenarios.ts"
import { serveStatic } from "./serve.ts"

const usage = `ui-parity: compare the legacy React UI against the Foldkit UI

  PARITY_PORT_BASE=4900 offsets every port (default 4790) so worktrees can run in parallel

  bun parity build <legacy|foldkit> [--ref <git-ref>]   build a target against the fixture backend
  bun parity serve [--dataset default]                  fixture backend + both builds, for side-by-side browsing
  bun parity run [--filter x] [--baseline legacy] [--candidate foldkit] [--run name]
                                                        capture both targets, diff, write the report
  bun parity compare --run name [--baseline legacy] [--candidate foldkit]
                                                        re-diff an existing run's captures (no recapture)
  bun parity selfcheck [--filter x] [--target legacy]   capture one target twice; anything not identical is flaky
  bun parity capture <target> [--filter x] [--run name] capture one target (screenshots, snapshots, reference DOM)
  bun parity codegen <file.html> [--line N] [--name viewName]  reference markup → Foldkit view code
  bun parity list                                       list scenario variants
  bun parity coverage                                   legacy routes and the scenarios that cover them
`

const { positionals, values } = parseArgs({
	args: Bun.argv.slice(2),
	allowPositionals: true,
	options: {
		ref: { type: "string" },
		filter: { type: "string" },
		baseline: { type: "string", default: "legacy" },
		candidate: { type: "string", default: "foldkit" },
		target: { type: "string", default: "legacy" },
		run: { type: "string" },
		dataset: { type: "string", default: "default" },
		tolerance: { type: "string", default: "0" },
		line: { type: "string" },
		name: { type: "string" },
	},
})

const identityFor = (datasetName: string) => {
	const dataset = datasets.get(datasetName)
	if (!dataset) throw new Error(`unknown dataset ${datasetName}`)
	return clerkIdentityFor(dataset)
}

/** Starts the fixture backend plus a static server for each requested target. */
const startServers = (names: ReadonlyArray<TargetName>, datasetName = "default") => {
	const backend = startFixtureBackend({
		port: FIXTURE_BACKEND_PORT,
		electricPort: FIXTURE_ELECTRIC_PORT,
		datasets,
		defaultDataset: datasetName,
	})
	const statics = [...new Set(names)].map((name) => {
		const dir = buildDir(name)
		if (!existsSync(join(dir, "index.html")))
			throw new Error(`No build for "${name}". Run: bun parity build ${name}`)
		// Builds embed the backend URLs; one made for another base would talk to someone else's backend.
		const stampFile = join(dir, BUILD_STAMP_FILE)
		const stamp = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, "utf8")) : { portBase: 4790 }
		if (stamp.portBase !== PORT_BASE)
			throw new Error(
				`Build "${name}" targets PARITY_PORT_BASE=${stamp.portBase}, not ${PORT_BASE}. Rebuild: bun parity build ${name}`,
			)
		return serveStatic(dir, targets[name].port, identityFor(datasetName))
	})
	return {
		backend,
		stop: async () => {
			for (const server of statics) server.stop(true)
			await backend.stop()
		},
	}
}

const timestamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)

const compareRun = (input: {
	run: string
	baselineLabel: string
	candidateLabel: string
	variants: ReturnType<typeof expandVariants>
	baselineResults: CaptureResult[]
	candidateResults: CaptureResult[]
}) => {
	const runDir = join(outDir, "runs", input.run)
	const diffDir = join(runDir, "diff")
	mkdirSync(diffDir, { recursive: true })
	// A capture that crashed or logged errors is not evidence of parity, whatever the pixels say.
	const unhealthy = new Map(
		[...input.baselineResults, ...input.candidateResults]
			.filter((result) => !result.ok || result.consoleErrors.length > 0)
			.map((result) => [result.variantId, result]),
	)
	const comparisons = input.variants.map((variant) => {
		const comparison = compareVariant({
			variantId: variant.id,
			baselineDir: captureDir(input.run, input.baselineLabel),
			candidateDir: captureDir(input.run, input.candidateLabel),
			outDir: diffDir,
			tolerance: Number(values.tolerance),
			ignoreBackgroundCalls: variant.scenario.path.startsWith("/dev/gallery/"),
		})
		return unhealthy.has(variant.id) && comparison.status !== "missing"
			? { ...comparison, status: "fail" as const }
			: comparison
	})
	const summary = buildSummary({
		run: input.run,
		baseline: input.baselineLabel,
		candidate: input.candidateLabel,
		variants: input.variants,
		comparisons,
		baselineResults: input.baselineResults,
		candidateResults: input.candidateResults,
	})
	const report = writeReport(summary, runDir)
	console.log(
		`\nidentical ${summary.totals.identical} · pass ${summary.totals.pass} · fail ${summary.totals.fail} · missing ${summary.totals.missing}`,
	)
	console.log(`report:  ${report}\nsummary: ${join(runDir, "summary.md")}`)
	return summary
}

const command = positionals[0]

switch (command) {
	case "build": {
		const name = positionals[1] as TargetName
		if (!targets[name]) throw new Error(usage)
		await buildTarget(name, { ref: values.ref })
		break
	}

	case "serve": {
		const available = (Object.keys(targets) as TargetName[]).filter((name) =>
			existsSync(join(buildDir(name), "index.html")),
		)
		const servers = startServers(available, values.dataset)
		console.log(
			`fixture backend  ${servers.backend.url}  (dataset: ${values.dataset}, port base ${PORT_BASE})`,
		)
		for (const name of available) console.log(`${name.padEnd(16)} http://localhost:${targets[name].port}`)
		console.log("ctrl+c to stop")
		process.on("SIGINT", async () => {
			await servers.stop()
			process.exit(0)
		})
		await new Promise(() => {})
		break
	}

	case "list": {
		for (const variant of expandVariants(values.filter))
			console.log(`${variant.id.padEnd(48)} ${variant.scenario.path}`)
		break
	}

	case "capture": {
		const name = (positionals[1] ?? "legacy") as TargetName
		const run = values.run ?? `${timestamp()}-capture-${name}`
		const servers = startServers([name])
		const results = await captureTarget({ target: name, run, variants: expandVariants(values.filter) })
		await servers.stop()
		console.log(
			`\n${results.filter((result) => result.ok).length}/${results.length} captured → ${captureDir(run, name)}`,
		)
		break
	}

	case "codegen": {
		const file = positionals[1]
		if (!file) throw new Error(usage)
		console.log(
			codegenFile(file, { line: values.line ? Number(values.line) : undefined, name: values.name }),
		)
		break
	}

	case "coverage": {
		const routes = uncoveredRoutes()
		for (const { route, scenarios } of routes)
			console.log(`${scenarios.length ? "✓" : "✗"} ${route.padEnd(56)} ${scenarios.join(", ")}`)
		console.log(
			`\n${routes.filter((entry) => entry.scenarios.length).length}/${routes.length} routes covered`,
		)
		break
	}

	case "run": {
		const baseline = values.baseline as TargetName
		const candidate = values.candidate as TargetName
		const run = values.run ?? `${timestamp()}-${candidate}-vs-${baseline}`
		const variants = expandVariants(values.filter)
		const servers = startServers([baseline, candidate])
		const browser = await chromium.launch(BROWSER_LAUNCH_OPTIONS)
		// Same-target comparisons (legacy vs legacy) need distinct folders.
		const candidateLabel = baseline === candidate ? `${candidate}-b` : candidate
		const baselineResults = await captureTarget({ target: baseline, run, variants, browser })
		const candidateResults = await captureTarget({
			target: candidate,
			label: candidateLabel,
			run,
			variants,
			browser,
		})
		await browser.close()
		await servers.stop()
		if (servers.backend.log.unmocked.size)
			console.log(`\nunmocked RPCs: ${[...servers.backend.log.unmocked].join(", ")}`)
		const summary = compareRun({
			run,
			baselineLabel: baseline,
			candidateLabel,
			variants,
			baselineResults,
			candidateResults,
		})
		process.exitCode = summary.totals.fail + summary.totals.missing > 0 ? 1 : 0
		break
	}

	case "compare": {
		if (!values.run) throw new Error(usage)
		const baselineLabel = values.baseline
		const candidateLabel =
			values.baseline === values.candidate ? `${values.candidate}-b` : values.candidate
		const readResults = (label: string): CaptureResult[] =>
			JSON.parse(readFileSync(join(captureDir(values.run!, label), "_results.json"), "utf8"))
		const baselineResults = readResults(baselineLabel)
		const captured = new Set(baselineResults.map((result) => result.variantId))
		const summary = compareRun({
			run: values.run,
			baselineLabel,
			candidateLabel,
			variants: expandVariants(values.filter).filter((variant) => captured.has(variant.id)),
			baselineResults,
			candidateResults: readResults(candidateLabel),
		})
		process.exitCode = summary.totals.fail + summary.totals.missing > 0 ? 1 : 0
		break
	}

	case "selfcheck": {
		const target = values.target as TargetName
		const run = values.run ?? `${timestamp()}-selfcheck-${target}`
		const variants = expandVariants(values.filter)
		const servers = startServers([target])
		const browser = await chromium.launch(BROWSER_LAUNCH_OPTIONS)
		const first = await captureTarget({ target, label: `${target}-1`, run, variants, browser })
		const second = await captureTarget({ target, label: `${target}-2`, run, variants, browser })
		await browser.close()
		await servers.stop()
		const summary = compareRun({
			run,
			baselineLabel: `${target}-1`,
			candidateLabel: `${target}-2`,
			variants,
			baselineResults: first,
			candidateResults: second,
		})
		// Sub-perceptual noise (anti-aliasing) is tolerated; anything visible is flakiness.
		const flaky = summary.variants.filter(
			(entry) => entry.comparison.status === "fail" || entry.comparison.status === "missing",
		)
		console.log(
			flaky.length
				? `\nFLAKY: ${flaky.map((entry) => entry.variant.id).join(", ")}`
				: "\nAll variants deterministic.",
		)
		const failedCaptures = [...first, ...second].filter((result) => !result.ok)
		if (failedCaptures.length)
			console.log(
				`capture failures: ${failedCaptures.map((result) => `${result.variantId}: ${result.error}`).join("\n  ")}`,
			)
		process.exitCode = flaky.length || failedCaptures.length ? 1 : 0
		break
	}

	default:
		console.log(usage)
}
