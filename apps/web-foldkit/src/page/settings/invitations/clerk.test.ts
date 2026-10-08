// @vitest-environment jsdom
import { Effect, Exit } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"
import { revokeInvitation } from "./clerk"

/** The revoke looks the Clerk invitation up inside its own Effect; no handle survives a fetch. */

const pendingInvitation = (id: string, revoke: () => Promise<unknown>) => ({
	id,
	emailAddress: `${id}@hazel.test`,
	role: "org:member",
	createdAt: 0,
	revoke,
})

const stubClerk = (invitations: ReadonlyArray<ReturnType<typeof pendingInvitation>>) => {
	const getInvitations = vi.fn(() => Promise.resolve({ data: invitations }))
	vi.stubGlobal("Clerk", { organization: { getInvitations } })
	return getInvitations
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("revokeInvitation", () => {
	test("fetches the pending invitations and revokes the matching one, with no prior fetch", async () => {
		const revoke = vi.fn(() => Promise.resolve(null))
		const getInvitations = stubClerk([pendingInvitation("inv_1", revoke)])
		const exit = await Effect.runPromiseExit(revokeInvitation("inv_1"))
		expect(Exit.isSuccess(exit)).toBe(true)
		expect(getInvitations).toHaveBeenCalledOnce()
		expect(revoke).toHaveBeenCalledOnce()
	})

	test("an id that is no longer pending fails without revoking anything", async () => {
		const revoke = vi.fn(() => Promise.resolve(null))
		stubClerk([pendingInvitation("inv_2", revoke)])
		const exit = await Effect.runPromiseExit(revokeInvitation("inv_1"))
		expect(Exit.isFailure(exit)).toBe(true)
		expect(revoke).not.toHaveBeenCalled()
	})
})
