/**
 * T3 Code links in the `OrgObject`: the link a member saves, their sharing, and the access check
 * the T3 Code bot goes through (`./org/t3code.ts`).
 */
import type { OrganizationId, UserId } from "@hazel/schema"
import { Cause, Effect, Exit, Option, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import type { Directory } from "../../services/directory"
import { callObject } from "./calls"
import { orgTarget } from "./kinds"
import { ConnectIntegrationCall, DisconnectIntegrationCall } from "./org/integrations"
import {
	MarkT3CodeExpiredCall,
	T3CodeAccessCall,
	T3CodeLinkCall,
	type T3CodeMetadata,
	UpdateT3CodeSharingCall,
} from "./org/t3code"
import { ObjectStubs } from "./protocol"
import { makeTestObjects } from "./testing"

const uuid = () => crypto.randomUUID()

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const failureTag = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit)
		? Option.getOrUndefined(
				Option.map(Cause.findErrorOption(exit.cause), (error) => (error as { _tag: string })._tag),
			)
		: undefined

const metadata = (expiresAt: string | null): T3CodeMetadata => ({
	environmentUrl: "https://mac.t3.example",
	mcpUrl: "https://mac.t3.example/mcp",
	environmentId: "env-1",
	environmentLabel: "Alice's MacBook",
	expiresAt,
})

const inAMonth = () => new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()

const makeWorld = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const orgId = uuid() as OrganizationId
	const [alice, bob, carol] = [uuid(), uuid(), uuid()] as UserId[] as [UserId, UserId, UserId]
	const org = yield* objects.get(orgTarget(orgId))
	org.storage.db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Acme', 'acme')`).run(orgId)
	for (const userId of [alice, bob, carol]) {
		org.storage.db
			.prepare(
				`INSERT INTO organization_members (id, organizationId, userId, role) VALUES (?, ?, ?, 'member')`,
			)
			.run(uuid(), orgId, userId)
	}
	const worker = <A, E>(effect: Effect.Effect<A, E, ObjectStubs | Directory>) =>
		effect.pipe(
			Effect.provideService(ObjectStubs, objects.stubs),
			Effect.provideContext(objects.directory),
		)
	const link = (expiresAt: string | null = inAMonth()) =>
		worker(
			callObject(ConnectIntegrationCall, orgTarget(orgId), {
				provider: "t3code",
				userId: alice,
				connectedBy: alice,
				externalAccountId: "env-1",
				externalAccountName: "Alice's MacBook",
				settings: { mode: "private", userIds: [] },
				metadata: { ...metadata(expiresAt) },
				tokens: {
					accessToken: "t3_mcp_secret",
					refreshToken: null,
					expiresAt: expiresAt === null ? null : new Date(expiresAt),
					scope: null,
				},
			}),
		)
	const access = (actorId: UserId) =>
		worker(callObject(T3CodeAccessCall, orgTarget(orgId), { ownerId: alice, actorId })).pipe(Effect.exit)
	const share = (mode: "private" | "organization" | "members", userIds: ReadonlyArray<UserId> = []) =>
		worker(
			callObject(UpdateT3CodeSharingCall, orgTarget(orgId), {
				userId: alice,
				sharing: { mode, userIds },
			}),
		)
	return { objects, org, orgId, alice, bob, carol, worker, link, access, share }
}).pipe(Effect.orDie)

describe("T3 Code links", () => {
	it("saves a member's link as theirs alone, private by default", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* world.link()
				const link = yield* world.worker(
					callObject(T3CodeLinkCall, orgTarget(world.orgId), { userId: world.alice }),
				)
				expect(link).toMatchObject({
					status: "active",
					sharing: { mode: "private", userIds: [] },
					metadata: { environmentLabel: "Alice's MacBook", mcpUrl: "https://mac.t3.example/mcp" },
				})
				expect(link?.connection.level).toBe("user")
				expect(
					yield* world.worker(
						callObject(T3CodeLinkCall, orgTarget(world.orgId), { userId: world.bob }),
					),
				).toBeNull()

				const owner = yield* world.access(world.alice)
				expect(Exit.isSuccess(owner) && owner.value.accessToken).toBe("t3_mcp_secret")
				expect(failureTag(yield* world.access(world.bob))).toBe("T3CodeAccessDeniedError")
			}),
		))

	it("lets the members the owner shares with drive it, and nobody else", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* world.link()

				yield* world.share("organization")
				expect(Exit.isSuccess(yield* world.access(world.bob))).toBe(true)
				expect(Exit.isSuccess(yield* world.access(world.carol))).toBe(true)

				// The owner in the list is dropped: they are always allowed.
				const shared = yield* world.share("members", [world.bob, world.bob, world.alice])
				expect(shared.sharing).toEqual({ mode: "members", userIds: [world.bob] })
				expect(Exit.isSuccess(yield* world.access(world.bob))).toBe(true)
				expect(failureTag(yield* world.access(world.carol))).toBe("T3CodeAccessDeniedError")

				yield* world.share("private")
				expect(failureTag(yield* world.access(world.bob))).toBe("T3CodeAccessDeniedError")
				expect(Exit.isSuccess(yield* world.access(world.alice))).toBe(true)
			}),
		))

	it("refuses a lapsed or revoked credential, telling only members it is shared with", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* world.link(new Date(Date.now() - 1000).toISOString())
				yield* world.share("members", [world.bob])
				const link = yield* world.worker(
					callObject(T3CodeLinkCall, orgTarget(world.orgId), { userId: world.alice }),
				)
				expect(link?.status).toBe("expired")
				expect(failureTag(yield* world.access(world.alice))).toBe("T3CodeExpiredError")
				expect(failureTag(yield* world.access(world.bob))).toBe("T3CodeExpiredError")
				expect(failureTag(yield* world.access(world.carol))).toBe("T3CodeAccessDeniedError")

				// Reconnecting replaces the credential; T3 refusing it later marks it expired.
				yield* world.link()
				expect(Exit.isSuccess(yield* world.access(world.alice))).toBe(true)
				yield* world.worker(
					callObject(MarkT3CodeExpiredCall, orgTarget(world.orgId), { ownerId: world.alice }),
				)
				expect(failureTag(yield* world.access(world.alice))).toBe("T3CodeExpiredError")
			}),
		))

	it("forgets the link on disconnect", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				expect(failureTag(yield* world.share("organization").pipe(Effect.exit))).toBe(
					"T3CodeNotConnectedError",
				)
				yield* world.link()
				yield* world.worker(
					callObject(DisconnectIntegrationCall, orgTarget(world.orgId), {
						provider: "t3code",
						userId: world.alice,
					}),
				)
				expect(failureTag(yield* world.access(world.alice))).toBe("T3CodeNotConnectedError")
				const tokens = world.org.storage.db
					.prepare(`SELECT COUNT(*) AS n FROM integration_tokens`)
					.get() as {
					n: number
				}
				expect(tokens.n).toBe(0)
			}),
		))
})
