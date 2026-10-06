import { $ } from "bun"
import { existsSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { buildDir, buildEnv, repoRoot, targets, type TargetName } from "./config.ts"

/**
 * Builds a target into `.parity/builds/<target>`.
 *
 * `ref` pins the build to a git commit via a throwaway worktree. Pin the legacy
 * baseline (e.g. the last commit before migration work started) so the reference
 * UI never drifts while the Foldkit app is being written.
 */
export const buildTarget = async (name: TargetName, options: { readonly ref?: string } = {}) => {
	const target = targets[name]
	let root = repoRoot
	if (options.ref) {
		// Outside the repo so root-level tooling (vitest, oxlint, tsc) never crawls a second checkout.
		root = resolve(homedir(), ".cache/hazel-ui-parity/worktrees", `${name}-${options.ref}`)
		if (!existsSync(root)) {
			await $`git -C ${repoRoot} worktree add --detach ${root} ${options.ref}`
			await $`bun install --frozen-lockfile`.cwd(root)
		}
	}
	const appDir = resolve(root, target.appDir)
	if (!existsSync(appDir)) throw new Error(`ui-parity: ${appDir} does not exist (target "${name}")`)

	const dest = buildDir(name)
	rmSync(dest, { recursive: true, force: true })
	console.log(`[build] ${name}${options.ref ? ` @ ${options.ref}` : ""} → ${dest}`)
	await $`bunx vite build --outDir ${dest} --emptyOutDir`.cwd(appDir).env({ ...process.env, ...buildEnv })
	return dest
}
