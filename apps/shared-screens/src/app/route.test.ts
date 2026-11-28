// @effect-diagnostics experimentalApiUsage:off
import { describe, expect, it } from "vitest"
import { AppRoute, hrefOf, routeOfPath } from "./route"
import parity from "./route.parity.json"

/**
 * The table's answers for every route and its edge cases, recorded from the web's foldkit table
 * before it moved here (`route.parity.json`): same values, same printed URLs.
 */
describe("routeOfPath and hrefOf", () => {
	for (const row of parity) {
		it(row.path, () => {
			const route = routeOfPath(row.path)
			expect(JSON.parse(JSON.stringify(route))).toEqual(row.route)
			expect(hrefOf(route)).toBe(row.href)
		})
	}

	it("prints what it parses", () => {
		const route = AppRoute.ChatChannel({
			orgSlug: "hazel",
			channelId: "00000003-0000-4000-8000-000000000001" as never,
		})
		expect(routeOfPath(hrefOf(route))).toEqual(route)
	})
})
