/** `POST /internal/import/*` stays off on prd unless the import deploy explicitly enabled it. */
import { Layer } from "effect"
import { HttpRouter } from "effect/http"
import { afterAll, describe, expect, it } from "vitest"
import { makeImportRoute } from "./import-route"

const webs: Array<ReturnType<typeof HttpRouter.toWebHandler>> = []
afterAll(async () => {
	for (const web of webs) await web.dispose()
})

/** The status a wrong bearer gets: 404 while the route is off, 401 once it is on. */
const statusFor = async (env: Record<string, unknown>) => {
	const web = HttpRouter.toWebHandler(makeImportRoute(env) as Layer.Layer<never>, { disableLogger: true })
	webs.push(web)
	const response = await (web.handler as (request: Request) => Promise<Response>)(
		new Request("http://api.test/internal/import/org/o-1", {
			method: "POST",
			headers: { authorization: "Bearer wrong" },
			body: "{}",
		}),
	)
	return response.status
}

describe("import route", () => {
	it("is off on prd with only the secret, on with IMPORT_ENABLED=true", async () => {
		expect(await statusFor({ HAZEL_STAGE: "prd", IMPORT_SECRET: "s" })).toBe(404)
		expect(await statusFor({ IMPORT_SECRET: "s" })).toBe(404)
		expect(await statusFor({ HAZEL_STAGE: "prd", IMPORT_SECRET: "s", IMPORT_ENABLED: "true" })).toBe(401)
	})

	it("is on with the secret on a non-prd stage, off without it", async () => {
		expect(await statusFor({ HAZEL_STAGE: "pr", IMPORT_SECRET: "s" })).toBe(401)
		expect(await statusFor({ HAZEL_STAGE: "dev", IMPORT_SECRET: "s" })).toBe(401)
		expect(await statusFor({ HAZEL_STAGE: "dev" })).toBe(404)
	})
})
