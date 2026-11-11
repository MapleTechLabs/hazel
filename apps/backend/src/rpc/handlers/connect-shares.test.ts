import { describe, expect, it } from "vitest"
import { PermissionError } from "@hazel/domain"
import { ConnectWorkspaceNotFoundError } from "@hazel/domain/rpc"
import type { OrganizationId } from "@hazel/schema"
import { Effect, Option } from "effect"
import {
	assertGuestMemberAddsAllowed,
	resolveGuestOrganizationForInviteCreate,
	validateInviteAcceptanceTarget,
} from "./connect-shares"

const GUEST_ORG_ID = "00000000-0000-4000-8000-000000000102" as OrganizationId
const OTHER_GUEST_ORG_ID = "00000000-0000-4000-8000-000000000103" as OrganizationId

describe("connect-shares helpers", () => {
	it("rejects invite creation when provided org and slug resolve to different workspaces", async () => {
		const result = await Effect.runPromise(
			resolveGuestOrganizationForInviteCreate({
				providedOrgId: GUEST_ORG_ID,
				target: { kind: "slug", value: "other-workspace" },
				findBySlug: () => Effect.succeed(Option.some({ id: OTHER_GUEST_ORG_ID })),
			}).pipe(Effect.result) as Effect.Effect<any, never, never>,
		)

		expect(result._tag).toBe("Failure")
		if (result._tag === "Failure") {
			expect(result.failure).toBeInstanceOf(ConnectWorkspaceNotFoundError)
		}
	})

	it("rejects slug invite acceptance for the wrong organization", async () => {
		const result = await Effect.runPromise(
			validateInviteAcceptanceTarget({
				invite: {
					targetKind: "slug",
					targetValue: "guest-workspace",
					guestOrganizationId: GUEST_ORG_ID,
				},
				guestOrganizationId: OTHER_GUEST_ORG_ID,
				findBySlug: () => Effect.succeed(Option.some({ id: GUEST_ORG_ID })),
			}).pipe(Effect.result) as Effect.Effect<any, never, never>,
		)

		expect(result._tag).toBe("Failure")
		if (result._tag === "Failure") {
			expect(result.failure).toBeInstanceOf(ConnectWorkspaceNotFoundError)
		}
	})

	it("rejects unbound email invite acceptance", async () => {
		const result = await Effect.runPromise(
			validateInviteAcceptanceTarget({
				invite: {
					targetKind: "email",
					targetValue: "guest@example.com",
					guestOrganizationId: null,
				},
				guestOrganizationId: GUEST_ORG_ID,
				findBySlug: () => Effect.succeed(Option.none()),
			}).pipe(Effect.result) as Effect.Effect<any, never, never>,
		)

		expect(result._tag).toBe("Failure")
		if (result._tag === "Failure") {
			expect(result.failure).toBeInstanceOf(ConnectWorkspaceNotFoundError)
		}
	})

	it("denies guest member adds when the mount disallows them", async () => {
		const result = await Effect.runPromise(
			assertGuestMemberAddsAllowed({
				role: "guest",
				allowGuestMemberAdds: false,
			}).pipe(Effect.result) as Effect.Effect<any, never, never>,
		)

		expect(result._tag).toBe("Failure")
		if (result._tag === "Failure") {
			expect(result.failure).toBeInstanceOf(PermissionError)
		}
	})

	it("allows member adds for host mounts and guest mounts with the setting enabled", async () => {
		const hostResult = await Effect.runPromise(
			assertGuestMemberAddsAllowed({
				role: "host",
				allowGuestMemberAdds: false,
			}).pipe(Effect.result) as Effect.Effect<any, never, never>,
		)
		const guestResult = await Effect.runPromise(
			assertGuestMemberAddsAllowed({
				role: "guest",
				allowGuestMemberAdds: true,
			}).pipe(Effect.result) as Effect.Effect<any, never, never>,
		)

		expect(hostResult._tag).toBe("Success")
		expect(guestResult._tag).toBe("Success")
	})
})
