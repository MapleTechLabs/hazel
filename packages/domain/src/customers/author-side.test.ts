import { OrganizationId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { type AuthorFacts, classifyAuthor, isConversational, shadowProviderOf } from "./author-side"

const guest: AuthorFacts = {
	_tag: "ConnectGuest",
	homeOrganizationId: OrganizationId.make("00000000-0000-4000-8000-000000000001"),
}
const external = (workspace: "home" | "other" | null): AuthorFacts => ({
	_tag: "External",
	provider: "slack",
	workspace,
})

describe("classifyAuthor", () => {
	it.each([
		[{ _tag: "Member" } as AuthorFacts, "team", "org_member"],
		[{ _tag: "FormerMember" } as AuthorFacts, "team", "former_member"],
		[guest, "customer", "connect_guest"],
		[external("other"), "customer", "external_other_workspace"],
		[external("home"), "team", "external_home_workspace"],
		[external(null), "customer", "external"],
		[{ _tag: "Bot" } as AuthorFacts, "bot", "bot"],
		[{ _tag: "Unknown" } as AuthorFacts, "unknown", "unknown"],
	] as const)("%o is %s (%s)", (facts, side, reason) => {
		expect(classifyAuthor(facts, null)).toEqual({ side, reason })
	})

	it("an override wins over the facts", () => {
		expect(classifyAuthor({ _tag: "Member" }, "customer")).toEqual({
			side: "customer",
			reason: "override",
		})
		expect(classifyAuthor(external(null), "team")).toEqual({ side: "team", reason: "override" })
		expect(classifyAuthor({ _tag: "Unknown" }, "customer")).toEqual({
			side: "customer",
			reason: "override",
		})
	})

	it("a bot stays a bot", () => {
		expect(classifyAuthor({ _tag: "Bot" }, "customer")).toEqual({ side: "bot", reason: "bot" })
	})
})

describe("isConversational", () => {
	it("keeps the customer and the team only", () => {
		expect(
			["customer", "team", "bot", "unknown"].filter((side) => isConversational(side as never)),
		).toEqual(["customer", "team"])
	})
})

describe("shadowProviderOf", () => {
	it("reads chat-sync shadows only", () => {
		expect(shadowProviderOf("slack-user-U123")).toBe("slack")
		expect(shadowProviderOf("discord-user-42")).toBe("discord")
		expect(shadowProviderOf("integration-bot-slack")).toBeNull()
		expect(shadowProviderOf("user_2abc")).toBeNull()
	})
})
