/**
 * Email invitations end to end against an in-memory SQLite database: inviting (admins only, members
 * skipped, one email per address), the public preview, accepting with the invited account, and
 * revoking. Emails are captured instead of sent.
 */
import { InvitationRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser } from "@hazel/domain"
import { CurrentRpcScopes } from "@hazel/domain/scopes"
import type { ApiScope } from "@hazel/domain/scopes"
import { OrganizationId, UserId } from "@hazel/schema"
import { ConfigProvider, Effect, Exit, Layer, Option, Schema } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createChatSyncDbHarness, type ChatSyncDbHarness } from "../test/chat-sync-db-harness"
import { type InviteEmail, InviteMailer } from "./invite-mailer"
import { Invitations } from "./invitations"

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const orgId = Schema.decodeSync(OrganizationId)(id(1))
const owner = Schema.decodeSync(UserId)(id(10))
const member = Schema.decodeSync(UserId)(id(11))
const invitee = Schema.decodeSync(UserId)(id(12))

const users = {
	[owner]: "owner@hazel.test",
	[member]: "member@hazel.test",
	[invitee]: "Invitee@Hazel.test",
} as const

const actor = (userId: UserId) =>
	new CurrentUser.Schema({
		id: userId,
		role: "member",
		organizationId: undefined,
		avatarUrl: undefined,
		firstName: "Test",
		lastName: "User",
		email: users[userId as keyof typeof users],
		isOnboarded: true,
		timezone: null,
		settings: null,
	})

let harness: ChatSyncDbHarness
const sent: Array<InviteEmail> = []

const CaptureMailer = Layer.succeed(InviteMailer, {
	send: (invite) => Effect.sync(() => void sent.push(invite)),
})

/** Runs as `userId` with the RPC's annotated scope, like a request through the RPC middleware. */
const run = <A, E, R>(
	userId: UserId,
	scope: ApiScope,
	effect: (invitations: typeof Invitations.Service) => Effect.Effect<A, E, R>,
) =>
	harness.run(
		Effect.gen(function* () {
			const invitations = yield* Invitations
			return yield* Effect.exit(effect(invitations))
		}).pipe(
			Effect.provideService(CurrentUser.Context, actor(userId)),
			Effect.provideService(CurrentRpcScopes, [scope]),
			Effect.provide(Invitations.layer),
			Effect.provide(CaptureMailer),
			Effect.provide(
				ConfigProvider.layer(ConfigProvider.fromUnknown({ FRONTEND_URL: "https://app.hazel.test" })),
			),
		),
	)

const tokenOf = (invite: InviteEmail) => new URL(invite.acceptUrl).pathname.split("/").at(-1)!

const failureTag = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit)
		? exit.cause.reasons.map((reason) =>
				"error" in reason &&
				typeof reason.error === "object" &&
				reason.error !== null &&
				"_tag" in reason.error
					? String(reason.error._tag)
					: reason._tag,
			)
		: []

describe("invitations", () => {
	beforeAll(async () => {
		harness = await createChatSyncDbHarness()
		await harness.reset()
		await harness.run(
			Effect.gen(function* () {
				const db = yield* Database.Database
				const setupSql = `
						INSERT INTO users (id, "externalId", email, "firstName", "lastName", "userType", "isOnboarded", "createdAt", "updatedAt")
						VALUES
							('${owner}', 'owner', '${users[owner]}', 'Olive', 'Owner', 'user', true, strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', 'now')),
							('${member}', 'member', '${users[member]}', 'Max', 'Member', 'user', true, strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', 'now')),
							('${invitee}', 'invitee', '${users[invitee]}', 'Ivy', 'Invitee', 'user', true, strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', 'now'));
						INSERT INTO organizations (id, name, slug, "isPublic", "createdAt", "updatedAt")
						VALUES ('${orgId}', 'Hazel Labs', 'hazel-labs', false, strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', 'now'));
						INSERT INTO organization_members (id, "organizationId", "userId", role, "joinedAt", "createdAt")
						VALUES
							('${id(20)}', '${orgId}', '${owner}', 'owner', strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', 'now')),
							('${id(21)}', '${orgId}', '${member}', 'member', strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', 'now'));
					`
				yield* Effect.forEach(
					setupSql.split(";").filter((statement) => statement.trim() !== ""),
					(statement) => db.execute(Database.sql.raw(statement)),
				)
			}),
		)
	}, 120_000)

	afterAll(async () => {
		await harness?.stop()
	})

	it("only admins and owners invite", async () => {
		const exit = await run(member, "organization-members:write", (invitations) =>
			invitations.create({ organizationId: orgId, emails: ["new@hazel.test"], role: "member" }),
		)
		expect(failureTag(exit)).toEqual(["UnauthorizedError"])
	})

	it("invites new addresses, skips members, and the invited account accepts", async () => {
		sent.length = 0
		const created = await run(owner, "organization-members:write", (invitations) =>
			invitations.create({
				organizationId: orgId,
				emails: ["invitee@hazel.test", "MEMBER@hazel.test"],
				role: "admin",
			}),
		)
		expect(Exit.isSuccess(created) && created.value.invited.map((invite) => invite.email)).toEqual([
			"invitee@hazel.test",
		])
		expect(Exit.isSuccess(created) && created.value.skipped).toEqual([
			{ email: "member@hazel.test", reason: "AlreadyMember" },
		])
		expect(sent).toHaveLength(1)
		expect(sent[0]).toMatchObject({ to: "invitee@hazel.test", organizationName: "Hazel Labs" })
		expect(sent[0]!.acceptUrl).toMatch(/^https:\/\/app\.hazel\.test\/invite\//)
		const token = tokenOf(sent[0]!)

		const listed = await run(owner, "organization-members:read", (invitations) =>
			invitations.list({ organizationId: orgId }),
		)
		expect(Exit.isSuccess(listed) && listed.value.map((invite) => invite.role)).toEqual(["admin"])

		const preview = await run(member, "organizations:read", (invitations) =>
			invitations.preview({ token }),
		)
		expect(Exit.isSuccess(preview) && preview.value.status).toBe("Pending")

		const wrongAccount = await run(member, "organizations:write", (invitations) =>
			invitations.accept({ token }),
		)
		expect(failureTag(wrongAccount)).toEqual(["InvitationEmailMismatchError"])

		const accepted = await run(invitee, "organizations:write", (invitations) =>
			invitations.accept({ token }),
		)
		expect(Exit.isSuccess(accepted) && accepted.value.slug).toBe("hazel-labs")
		const role = await harness.run(
			Effect.gen(function* () {
				const db = yield* Database.Database
				return yield* db.run(
					SQLite.from(schema.organizationMembersTable)
						.select("role")
						.where(($) => [$.organizationId.eq(orgId), $.userId.eq(invitee)]),
				)
			}),
		)
		expect(role).toEqual([{ role: "admin" }])

		const again = await run(invitee, "organizations:write", (invitations) =>
			invitations.accept({ token }),
		)
		expect(failureTag(again)).toEqual(["InvitationUnavailableError"])
	}, 60_000)

	it("re-inviting replaces the link, and a revoked link stops working", async () => {
		sent.length = 0
		const invite = () =>
			run(owner, "organization-members:write", (invitations) =>
				invitations.create({ organizationId: orgId, emails: ["late@hazel.test"], role: "member" }),
			)
		await invite()
		const second = await invite()
		const [first, latest] = [tokenOf(sent[0]!), tokenOf(sent[1]!)]
		expect(first).not.toBe(latest)

		const stale = await run(member, "organizations:read", (invitations) =>
			invitations.preview({ token: first }),
		)
		expect(failureTag(stale)).toEqual(["InvitationNotFoundError"])

		const invitationId = Exit.isSuccess(second) ? second.value.invited[0]!.id : undefined
		const revoked = await run(owner, "organization-members:write", (invitations) =>
			invitations.revoke({ id: invitationId! }),
		)
		expect(Exit.isSuccess(revoked)).toBe(true)
		const preview = await run(member, "organizations:read", (invitations) =>
			invitations.preview({ token: latest }),
		)
		expect(Exit.isSuccess(preview) && preview.value.status).toBe("Revoked")
	}, 60_000)
	it("a stale send failure or acceptance cannot consume a replacement invitation", async () => {
		const result = await harness.run(
			Effect.gen(function* () {
				const repo = yield* InvitationRepo
				const data = {
					organizationId: orgId,
					email: "race@hazel.test",
					role: "member" as const,
					invitedBy: owner,
					expiresAt: new Date(Date.now() + 60000),
				}
				const first = yield* repo.upsertPending({ ...data, tokenHash: "first-token" })
				const replacement = yield* repo.upsertPending({ ...data, tokenHash: "replacement-token" })
				const revoked = yield* repo.revoke(first.id, first.tokenHash)
				const accepted = yield* repo.markAccepted(first.id, invitee, first.tokenHash)
				const pending = yield* repo.findById(replacement.id)
				return { revoked, accepted, pending }
			}).pipe(Effect.provide(InvitationRepo.layer)),
		)
		expect(Option.isNone(result.revoked)).toBe(true)
		expect(Option.isNone(result.accepted)).toBe(true)
		expect(Option.getOrNull(result.pending)?.status).toBe("pending")
	})

	it("inviting into a deleted organization fails with OrganizationNotFoundError, not a 500", async () => {
		const deletedOrgId = Schema.decodeSync(OrganizationId)(id(2))
		await harness.run(
			Effect.gen(function* () {
				const db = yield* Database.Database
				yield* db.execute(
					Database.sql.raw(
						`INSERT INTO organizations (id, name, slug, "isPublic", "createdAt", "updatedAt", "deletedAt")
						VALUES ('${deletedOrgId}', 'Gone Labs', 'gone-labs', false, strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
					),
				)
				yield* db.execute(
					Database.sql.raw(
						`INSERT INTO organization_members (id, "organizationId", "userId", role, "joinedAt", "createdAt")
						VALUES ('${id(22)}', '${deletedOrgId}', '${owner}', 'owner', strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
					),
				)
			}),
		)

		const exit = await run(owner, "organization-members:write", (invitations) =>
			invitations.create({ organizationId: deletedOrgId, emails: ["late@hazel.test"], role: "member" }),
		)
		expect(failureTag(exit)).toEqual(["OrganizationNotFoundError"])
	})
})
