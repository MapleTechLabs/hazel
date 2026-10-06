import { resolve } from "node:path"

export const repoRoot = resolve(import.meta.dir, "../../..")
export const parityRoot = resolve(import.meta.dir, "..")
/** Gitignored working area: builds, captures, reports. */
export const outDir = resolve(parityRoot, ".parity")

export const FIXTURE_BACKEND_PORT = 4790
/** Electric gets its own origin so shape polling never competes with RPC for connections. */
export const FIXTURE_ELECTRIC_PORT = 4793
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
	legacy: { name: "legacy", port: 4791, appDir: "apps/web", distDir: "dist" },
	/** The legacy app from the working tree: refactors of legacy code must stay identical to the pinned `legacy`. */
	"legacy-head": { name: "legacy-head", port: 4794, appDir: "apps/web", distDir: "dist" },
	// Placeholder until the Foldkit app exists; same contract: a Vite app reading the same env vars.
	foldkit: { name: "foldkit", port: 4792, appDir: "apps/web-foldkit", distDir: "dist" },
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

export const buildDir = (target: TargetName) => resolve(outDir, "builds", target)
