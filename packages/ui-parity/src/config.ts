import { resolve } from "node:path"

export const repoRoot = resolve(import.meta.dir, "../../..")
export const parityRoot = resolve(import.meta.dir, "..")
/** Gitignored working area: builds, captures, reports. */
export const outDir = resolve(parityRoot, ".parity")

/**
 * Every port is an offset from `PARITY_PORT_BASE` (default 4790), so parallel worktrees can run
 * the harness at once (e.g. 4900, 5000). Builds embed the backend URLs, so they are kept per base.
 */
export const DEFAULT_PORT_BASE = 4790
/** Ports Chromium refuses to load (net::ERR_UNSAFE_PORT) in the range a base can reach. */
const CHROMIUM_UNSAFE_PORTS = new Set([
	1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679,
	6697, 10080,
])
export const PORT_BASE = (() => {
	const raw = process.env.PARITY_PORT_BASE
	if (!raw) return DEFAULT_PORT_BASE
	const base = Number(raw)
	if (!Number.isInteger(base) || base < 1024 || base > 65000)
		throw new Error(`ui-parity: PARITY_PORT_BASE must be an integer port base, got "${raw}"`)
	const unsafe = [0, 1, 2, 3, 4]
		.map((offset) => base + offset)
		.filter((port) => CHROMIUM_UNSAFE_PORTS.has(port))
	if (unsafe.length)
		throw new Error(
			`ui-parity: PARITY_PORT_BASE=${base} reaches Chromium-blocked port ${unsafe.join(", ")}`,
		)
	return base
})()

export const FIXTURE_BACKEND_PORT = PORT_BASE
/** Electric gets its own origin so shape polling never competes with RPC for connections. */
export const FIXTURE_ELECTRIC_PORT = PORT_BASE + 3
/**
 * Every target is loaded through this origin (requests are proxied to the target's port), so
 * anything that prints `location.origin` renders identically across targets. Playwright fulfils it
 * in-browser and nothing binds it, so it stays fixed for every base and captures match across worktrees.
 */
export const CANONICAL_ORIGIN = "http://localhost:4800"
export const fixtureBackendUrl = `http://localhost:${FIXTURE_BACKEND_PORT}`
export const fixtureElectricUrl = `http://localhost:${FIXTURE_ELECTRIC_PORT}/v1/shape`

export type TargetName = "legacy" | "legacy-head" | "foldkit"

export interface Target {
	readonly name: TargetName
	readonly port: number
	/** App directory relative to the repo root (inside the worktree for pinned refs). */
	readonly appDir: string
	/** Vite output, relative to appDir. */
	readonly distDir: string
}

export const targets: Record<TargetName, Target> = {
	legacy: { name: "legacy", port: PORT_BASE + 1, appDir: "apps/web", distDir: "dist" },
	/** The legacy app from the working tree: refactors of legacy code must stay identical to the pinned `legacy`. */
	"legacy-head": { name: "legacy-head", port: PORT_BASE + 4, appDir: "apps/web", distDir: "dist" },
	// Placeholder until the Foldkit app exists; same contract: a Vite app reading the same env vars.
	foldkit: { name: "foldkit", port: PORT_BASE + 2, appDir: "apps/web-foldkit", distDir: "dist" },
}

/** Env both apps are built with: every backend points at the fixture server, analytics off. */
export const buildEnv = {
	VITE_BACKEND_URL: fixtureBackendUrl,
	VITE_ELECTRIC_URL: fixtureElectricUrl,
	VITE_CLUSTER_URL: `${fixtureBackendUrl}/cluster`,
	VITE_RIVET_URL: `${fixtureBackendUrl}/rivet`,
	VITE_R2_PUBLIC_URL: `${fixtureBackendUrl}/r2`,
	VITE_CLERK_PUBLISHABLE_KEY: "pk_test_cGFyaXR5LmNsZXJrLmludmFsaWQk",
	VITE_PUBLIC_POSTHOG_KEY: "",
	VITE_PUBLIC_POSTHOG_HOST: "",
} as const

export const buildDir = (target: TargetName) =>
	resolve(outDir, PORT_BASE === DEFAULT_PORT_BASE ? "builds" : `builds-${PORT_BASE}`, target)

/** Written into every build so a build is never served against a backend on another base. */
export const BUILD_STAMP_FILE = ".parity-build.json"
