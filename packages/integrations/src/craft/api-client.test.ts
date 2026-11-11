import { describe, expect, it } from "@effect/vitest"
import { normalizeCraftConnectionInfo, normalizeCraftSearchDocumentsResponse } from "./api-client"

describe("Craft API client connection probe helpers", () => {
	describe("normalizeCraftConnectionInfo", () => {
		it("prefers nested space metadata when present", () => {
			const normalized = normalizeCraftConnectionInfo({
				id: "connection-id",
				name: "Connection Name",
				type: "connection",
				space: {
					id: "space-id",
					name: "Team Space",
					type: "space",
				},
			})

			expect(normalized).toEqual({
				id: "space-id",
				name: "Team Space",
				type: "space",
			})
		})

		it("falls back to top-level fields when nested space is absent", () => {
			const normalized = normalizeCraftConnectionInfo({
				id: "space-id",
				name: "Team Space",
				type: "space",
			})

			expect(normalized).toEqual({
				id: "space-id",
				name: "Team Space",
				type: "space",
			})
		})
	})

	describe("normalizeCraftSearchDocumentsResponse", () => {
		it("returns array response as-is", () => {
			const input = [{ id: "a" }, { id: "b" }]
			expect(normalizeCraftSearchDocumentsResponse(input)).toEqual(input)
		})

		it("extracts items from wrapped response", () => {
			const input = { items: [{ id: "a" }] }
			expect(normalizeCraftSearchDocumentsResponse(input)).toEqual([{ id: "a" }])
		})

		it("returns empty array for unexpected response shape", () => {
			expect(normalizeCraftSearchDocumentsResponse({ foo: "bar" })).toEqual([])
		})
	})
})
