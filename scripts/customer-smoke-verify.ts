/**
 * Checks a freshly deployed customer install answers like one (`customer-install-smoke.yml`):
 *
 *   bun scripts/customer-smoke-verify.ts <zone> <expected commit>
 *
 * New custom domains can take a few minutes to get their certificates, so each check retries for
 * up to ten minutes before it fails.
 */

const [zone, expectedSha] = process.argv.slice(2)
if (!zone || !expectedSha) {
	console.error("usage: bun scripts/customer-smoke-verify.ts <zone> <expected commit>")
	process.exit(2)
}

const DEADLINE_MS = 10 * 60_000
const RETRY_MS = 15_000

/** Retries `check` until it returns undefined (passed) or the deadline; else the last problem. */
const eventually = async (name: string, check: () => Promise<string | undefined>) => {
	const started = Date.now()
	let problem: string | undefined
	for (;;) {
		problem = await check().catch((error: unknown) =>
			error instanceof Error ? error.message : String(error),
		)
		if (problem === undefined) {
			console.log(`✓ ${name}`)
			return true
		}
		if (Date.now() - started > DEADLINE_MS) {
			console.error(`✗ ${name}: ${problem}`)
			return false
		}
		console.log(`… ${name}: ${problem}; retrying`)
		await Bun.sleep(RETRY_MS)
	}
}

const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "manual" })

const api = `https://api.${zone}`
const app = `https://app.${zone}`

const results = [
	await eventually("api answers /health", async () => {
		const response = await get(`${api}/health`)
		const body = await response.text()
		return response.ok && body === "OK" ? undefined : `HTTP ${response.status} ${body.slice(0, 80)}`
	}),
	await eventually("api runs this commit on a customer stage", async () => {
		const body = (await (await get(`${api}/version`)).json()) as { version?: string; stage?: string }
		return body.version === expectedSha && body.stage === "customer"
			? undefined
			: `reports ${JSON.stringify(body)}, expected ${expectedSha} on customer`
	}),
	await eventually("sign-in offers GitHub", async () => {
		const body = (await (await get(`${api}/auth/providers`)).json()) as { providers?: Array<string> }
		return body.providers?.includes("github") ? undefined : `providers ${JSON.stringify(body)}`
	}),
	await eventually("web app serves its shell", async () => {
		const response = await get(app)
		const type = response.headers.get("content-type") ?? ""
		return response.ok && type.includes("text/html") ? undefined : `HTTP ${response.status} ${type}`
	}),
	await eventually("web app serves /.well-known/hazel.json", async () => {
		const response = await get(`${app}/.well-known/hazel.json`)
		if (!response.ok) return `HTTP ${response.status}`
		const body = await response.text()
		return body.includes(`api.${zone}`) ? undefined : `does not name api.${zone}: ${body.slice(0, 120)}`
	}),
]

process.exit(results.every(Boolean) ? 0 : 1)
