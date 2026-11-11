import { HttpApi } from "effect/http-api"
import { describe, expect, it } from "vitest"
import { HazelApi } from "./api"

describe("HazelApi", () => {
	// A router keeps one handler per route, so a second group declaring the same one is unreachable.
	it("declares each method and path once", () => {
		const routes: Array<string> = []
		HttpApi.reflect(HazelApi, {
			onGroup: () => {},
			onEndpoint: ({ endpoint }) => {
				routes.push(`${endpoint.method} ${endpoint.path}`)
			},
		})
		const repeated = routes.filter((route, index) => routes.indexOf(route) !== index)
		expect(repeated).toEqual([])
		expect(routes).toContain("GET /api/v1/organizations/:organizationId/bot-channels")
	})
})
