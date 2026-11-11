import { describe, expect, it } from "@effect/vitest"
import { CraftApiError, CraftNotFoundError, CraftRateLimitError } from "@hazel/integrations/craft"
import { Effect, Option, Result } from "effect"
import {
	mapCraftConnectApiKeyError,
	parseOAuthStateParam,
	validateCraftBaseUrl,
} from "./integrations.http.ts"

const expectInvalidBaseUrl = async (url: string) => {
	const result = await Effect.runPromise(validateCraftBaseUrl(url).pipe(Effect.result))
	expect(Result.isFailure(result)).toBe(true)
	if (Result.isFailure(result)) {
		expect(result.failure._tag).toBe("InvalidApiKeyError")
	}
}

describe("integration connect API key helpers", () => {
	describe("parseOAuthStateParam", () => {
		const baseState = {
			organizationId: "73f6777d-9ce4-4f88-88d4-33591ca59b7b",
			userId: "673a6dab-30df-40b4-b9df-be14e4b97c21",
			returnTo: "http://localhost:3000/hazel2/my-settings/linked-accounts",
			environment: "production" as const,
			level: "user" as const,
		}

		it("parses raw JSON state", () => {
			const parsed = Option.getOrThrow(parseOAuthStateParam(JSON.stringify(baseState)))
			expect(parsed.organizationId).toBe(baseState.organizationId)
			expect(parsed.userId).toBe(baseState.userId)
			expect(parsed.level).toBe(baseState.level)
		})

		it("parses URL-encoded JSON state", () => {
			const parsed = Option.getOrThrow(
				parseOAuthStateParam(encodeURIComponent(JSON.stringify(baseState))),
			)
			expect(parsed.organizationId).toBe(baseState.organizationId)
			expect(parsed.userId).toBe(baseState.userId)
			expect(parsed.level).toBe(baseState.level)
		})

		it("parses double URL-encoded JSON state (legacy)", () => {
			const parsed = Option.getOrThrow(
				parseOAuthStateParam(encodeURIComponent(encodeURIComponent(JSON.stringify(baseState)))),
			)
			expect(parsed.organizationId).toBe(baseState.organizationId)
			expect(parsed.userId).toBe(baseState.userId)
			expect(parsed.level).toBe(baseState.level)
		})

		it("defaults level to organization when missing", () => {
			const parsed = Option.getOrThrow(
				parseOAuthStateParam(
					JSON.stringify({
						organizationId: baseState.organizationId,
						userId: baseState.userId,
						returnTo: baseState.returnTo,
						environment: baseState.environment,
					}),
				),
			)
			expect(parsed.level).toBe("organization")
		})
	})

	describe("validateCraftBaseUrl", () => {
		it("accepts and normalizes a valid Craft connect URL", async () => {
			const result = await Effect.runPromise(
				validateCraftBaseUrl("https://connect.craft.do/links/link_123/api/v1/").pipe(Effect.result),
			)

			expect(Result.isSuccess(result)).toBe(true)
			if (Result.isSuccess(result)) {
				expect(result.success).toBe("https://connect.craft.do/links/link_123/api/v1")
			}
		})

		it("rejects non-https URLs", async () => {
			await expectInvalidBaseUrl("http://connect.craft.do/links/link_123/api/v1")
		})

		it("rejects untrusted hosts", async () => {
			await expectInvalidBaseUrl("https://example.com/links/link_123/api/v1")
		})

		it("rejects URL query params", async () => {
			await expectInvalidBaseUrl("https://connect.craft.do/links/link_123/api/v1?x=1")
		})
	})

	describe("mapCraftConnectApiKeyError", () => {
		it("maps Craft 401 failures to InvalidApiKeyError", () => {
			const mapped = mapCraftConnectApiKeyError(
				new CraftApiError({ message: "unauthorized", status: 401 }),
			)
			expect(mapped._tag).toBe("InvalidApiKeyError")
		})

		it("maps Craft not found failures to InvalidApiKeyError", () => {
			const mapped = mapCraftConnectApiKeyError(
				new CraftNotFoundError({ resourceType: "space", resourceId: "missing" }),
			)
			expect(mapped._tag).toBe("InvalidApiKeyError")
		})

		it("maps Craft rate limits to IntegrationUnavailableError", () => {
			const mapped = mapCraftConnectApiKeyError(
				new CraftRateLimitError({ message: "too many requests", retryAfter: 60 }),
			)
			expect(mapped._tag).toBe("IntegrationUnavailableError")
		})

		it("maps Craft 5xx failures to IntegrationUnavailableError", () => {
			const mapped = mapCraftConnectApiKeyError(
				new CraftApiError({ message: "server error", status: 503 }),
			)
			expect(mapped._tag).toBe("IntegrationUnavailableError")
		})

		it("maps Craft 4xx failures to InvalidApiKeyError", () => {
			const mapped = mapCraftConnectApiKeyError(
				new CraftApiError({ message: "bad request", status: 400 }),
			)
			expect(mapped._tag).toBe("InvalidApiKeyError")
		})

		it("maps Craft failures without status to IntegrationUnavailableError", () => {
			const mapped = mapCraftConnectApiKeyError(new CraftApiError({ message: "network error" }))
			expect(mapped._tag).toBe("IntegrationUnavailableError")
		})
	})
})
