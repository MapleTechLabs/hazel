import { describe, expect, it } from "vitest"
import { isTemporaryActorServiceError } from "./actor-service-errors"

describe("actor-service-errors", () => {
	it("classifies invalid bot token 404 messages as service errors", () => {
		expect(isTemporaryActorServiceError("Invalid bot token: Not Found")).toBe(true)
	})

	it("classifies auth service unavailable messages as service errors", () => {
		expect(isTemporaryActorServiceError(new Error("Authentication service unavailable"))).toBe(true)
	})

	it("classifies nested actor auth failures as service errors", () => {
		expect(
			isTemporaryActorServiceError({
				_tag: "CommandHandlerError",
				cause: {
					_tag: "ActorOperationError",
					cause: {
						code: "invalid_token",
						message: "Invalid bot token: Not Found",
					},
				},
			}),
		).toBe(true)
	})

	it("does not classify normal runtime failures as service errors", () => {
		expect(isTemporaryActorServiceError(new Error("Tool execution failed"))).toBe(false)
	})
})
