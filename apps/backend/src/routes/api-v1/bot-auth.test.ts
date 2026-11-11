import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { requireBotScope } from "./bot-auth"

const check = (scopes: ReadonlyArray<string> | null) =>
	Effect.runSync(Effect.exit(requireBotScope({ scopes }, "channels:read")))

describe("requireBotScope", () => {
	it("lets a bot holding the scope through", () => {
		expect(Exit.isSuccess(check(["messages:read", "channels:read"]))).toBe(true)
	})

	it("lets a bot with no scopes recorded through, as a member", () => {
		expect(Exit.isSuccess(check(null))).toBe(true)
	})

	it("refuses a bot whose scopes leave it out", () => {
		const error = Effect.runSync(
			Effect.flip(requireBotScope({ scopes: ["messages:read", "channels:write"] }, "channels:read")),
		)
		expect(error._tag).toBe("UnauthorizedError")
		expect(error.message).toContain("channels:read")
	})
})
