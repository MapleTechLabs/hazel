/**
 * Server releases: the commits a customer install deploys (`docs/self-hosting.md#releases`).
 * A release is a git tag `server-vYYYY.MM.DD` (`.N` for a second one that day) on a commit that
 * already runs Hazel's own production, cut by `.github/workflows/server-release.yml`.
 *
 * Not `v*`: those tags are the desktop app's releases (`tauri-release.yml`).
 */

export const RELEASE_TAG_PREFIX = "server-v"
/** For `git tag -l` / `git describe --match`. */
export const RELEASE_TAG_GLOB = `${RELEASE_TAG_PREFIX}*`

const RELEASE_RE = /^server-v(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?$/

/** A release tag's sortable parts: year, month, day, and the day's sequence number (1 if none). */
export const parseReleaseTag = (tag: string): ReadonlyArray<number> | undefined => {
	const match = RELEASE_RE.exec(tag.trim())
	if (!match) return undefined
	return [
		Number(match[1]),
		Number(match[2]),
		Number(match[3]),
		match[4] === undefined ? 1 : Number(match[4]),
	]
}

export const isReleaseTag = (tag: string) => parseReleaseTag(tag) !== undefined

const compare = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) => {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const diff = (a[i] ?? 0) - (b[i] ?? 0)
		if (diff !== 0) return diff
	}
	return 0
}

/** The newest release among `tags`; anything that is not a release tag is ignored. */
export const latestRelease = (tags: ReadonlyArray<string>): string | undefined =>
	tags
		.map((tag) => tag.trim())
		.filter(isReleaseTag)
		.sort((a, b) => compare(parseReleaseTag(b) ?? [], parseReleaseTag(a) ?? []))[0]

/** The tag for a release cut on `date` (UTC), after the ones `existing` already has that day. */
export const nextReleaseTag = (date: Date, existing: ReadonlyArray<string>): string => {
	const pad = (n: number) => String(n).padStart(2, "0")
	const base = `${RELEASE_TAG_PREFIX}${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`
	const taken = existing
		.map((tag) => tag.trim())
		.filter((tag) => tag === base || tag.startsWith(`${base}.`))
	if (taken.length === 0) return base
	const highest = Math.max(...taken.map((tag) => parseReleaseTag(tag)?.[3] ?? 1))
	return `${base}.${highest + 1}`
}

// `git tag -l | bun packages/setup/src/customer/releases.ts next|latest`: for the release workflow.
if (import.meta.main) {
	const tags = (await Bun.stdin.text()).split("\n").filter((tag) => tag.trim() !== "")
	const command = process.argv[2]
	if (command === "next") console.log(nextReleaseTag(new Date(), tags))
	else if (command === "latest") console.log(latestRelease(tags) ?? "")
	else {
		console.error("usage: git tag -l | bun packages/setup/src/customer/releases.ts next|latest")
		process.exit(2)
	}
}
