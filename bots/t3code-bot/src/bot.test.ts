import type { UserId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { explain, findProject, parseOwner } from "./bot"

const alice = "alice" as UserId
const bob = "bob" as UserId

describe("parseOwner", () => {
	it("reads a mention or a user id, nothing else", () => {
		expect(parseOwner("@[userId:0b8f8c1e-0000-4000-8000-000000000001]")).toBe(
			"0b8f8c1e-0000-4000-8000-000000000001",
		)
		expect(parseOwner(" 0b8f8c1e-0000-4000-8000-000000000001 ")).toBe(
			"0b8f8c1e-0000-4000-8000-000000000001",
		)
		expect(parseOwner("alice")).toBeNull()
		expect(parseOwner(undefined)).toBeNull()
		expect(parseOwner("")).toBeNull()
	})
})

describe("findProject", () => {
	const projects = [
		{ id: "p1", title: "hazel" },
		{ id: "p2", title: "hazel-auth" },
		{ id: "p3", title: "Maple" },
	]
	it("matches by id, exact title, then title prefix", () => {
		expect(findProject(projects, "p3")?.title).toBe("Maple")
		expect(findProject(projects, "HAZEL")?.id).toBe("p1")
		expect(findProject(projects, "hazel-a")?.id).toBe("p2")
		expect(findProject(projects, "map")?.id).toBe("p3")
		expect(findProject(projects, "nope")).toBeUndefined()
	})
})

describe("explain", () => {
	it("says whose environment and what to do", () => {
		expect(explain({ _tag: "T3CodeNotConnectedError" }, { ownerId: alice, actorId: alice })).toContain(
			"Settings → Integrations → T3 Code",
		)
		expect(explain({ _tag: "T3CodeNotConnectedError" }, { ownerId: bob, actorId: alice })).toBe(
			"@[userId:bob] has not linked T3 Code.",
		)
		expect(explain({ _tag: "T3CodeAccessDeniedError" }, { ownerId: bob, actorId: alice })).toBe(
			"@[userId:bob] does not share their T3 Code with you.",
		)
		expect(explain({ _tag: "T3CodeUnauthorizedError" }, { ownerId: alice, actorId: alice })).toMatch(
			/^Your T3 Code sign-in/,
		)
		expect(explain(new Error("boom"), { ownerId: alice, actorId: alice })).toBe(
			"Something went wrong talking to T3 Code.",
		)
	})
})
