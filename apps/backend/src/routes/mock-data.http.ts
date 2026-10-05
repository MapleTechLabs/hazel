import { HttpApiBuilder } from "effect/http-api"
import { Database } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import { GenerateMockDataResponse } from "@hazel/domain/http"
import { OrganizationId, UserId } from "@hazel/schema"
import { Effect } from "effect"
import { HazelApi } from "../api"
import { generateTransactionId } from "../lib/create-transactionId"
import { MockDataGenerator } from "../services/mock-data-generator"

export const HttpMockDataLive = HttpApiBuilder.group(HazelApi, "mockData", (handlers) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const mockDataService = yield* MockDataGenerator

		return handlers.handle(
			"generate",
			Effect.fn(function* ({ payload }) {
				const currentUser = yield* CurrentUser.Context

				const { result, txid } = yield* db
					.transaction(
						Effect.gen(function* () {
							const result = yield* mockDataService.generateForMarketingScreenshots({
								organizationId: OrganizationId.make(payload.organizationId),
								currentUserId: UserId.make(currentUser.id),
							})

							const txid = yield* generateTransactionId()

							return { result, txid }
						}),
					)
					.pipe(withRemapDbErrors("MockDataGenerator", "create"))

				return new GenerateMockDataResponse({
					transactionId: txid,
					created: result.summary,
				})
			}),
		)
	}),
)
