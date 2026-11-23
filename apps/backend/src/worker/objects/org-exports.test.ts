/**
 * Organization data exports on node SQLite: `organizationExport.*` run through the `OrgObject`'s
 * `invoke`, the build driven by its alarm across `ChannelObject`s, and the NDJSON parts read back
 * from the in-memory exports bucket.
 */
import { SQLite, schema } from "@hazel/db"
import { CurrentUser, UnauthorizedError } from "@hazel/domain"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Cause, Effect, Exit, Option, type Scope } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { Directory } from "../../services/directory"
import { orgExportPartKey } from "../../services/org-exports"
import { channelTarget, orgTarget } from "./kinds"
import { exportTuning } from "./org/exports"
import { encodeInvokePrincipal } from "./principal"
import { makeTestObjects, type TestObject, type TestObjects } from "./testing"

const uuid = () => crypto.randomUUID()

const userOf = (id: string) =>
	new CurrentUser.Schema({
		id: id as UserId,
		role: "member",
		email: `${id}@example.com`,
		isOnboarded: true,
		timezone: null,
		settings: null,
	})

const call = (object: TestObject, objectId: string, tag: HazelRpcTag, payload: unknown, user: string) =>
	Effect.gen(function* () {
		const rpc = yield* rpcFor(tag)
		const response = yield* object.invoke({
			objectId,
			tag,
			payload: yield* encodePayload(rpc, payload),
			principal: yield* encodeInvokePrincipal({ user: userOf(user), botScopes: null }),
		})
		return yield* decodeExit(rpc, structuredClone(response).exit)
	})

const ok = <A>(exit: Exit.Exit<A, unknown>) => {
	if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause))
	return exit.value as any
}

const errorTag = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit)
		? Option.match(Cause.findErrorOption(exit.cause), {
				onNone: () => undefined,
				onSome: (error) => (error as { _tag?: string })._tag,
			})
		: undefined

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const directoryUser = (objects: TestObjects, id: UserId, firstName: string) =>
	Effect.flatMap(Directory, (directory) =>
		directory.db.run(
			SQLite.insertInto(schema.usersTable).values({
				id,
				externalId: `ext-${id}`,
				email: `${id}@example.com`,
				firstName,
				lastName: "Last",
			}),
		),
	).pipe(Effect.provideContext(objects.directory), Effect.orDie)

const rows = <T>(object: TestObject, query: string, ...params: Array<string>) =>
	object.storage.db.prepare(query).all(...params) as Array<T>

const exec = (object: TestObject, query: string, ...params: Array<string | number | null>) =>
	object.storage.db.prepare(query).run(...params)

interface World {
	readonly objects: TestObjects
	readonly org: TestObject
	readonly orgId: OrganizationId
	readonly owner: UserId
	readonly member: UserId
	readonly general: ChannelId
}

const makeWorld = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const orgId = uuid() as OrganizationId
	const [owner, member] = [uuid(), uuid()] as Array<UserId>
	yield* directoryUser(objects, owner, "Olive")
	yield* directoryUser(objects, member, "Mel")
	const org = yield* objects.get(orgTarget(orgId))
	ok(
		yield* call(
			org,
			orgId,
			"organization.create",
			{ name: "Acme", slug: "acme", logoUrl: null, settings: null, isPublic: false },
			owner,
		),
	)
	ok(yield* call(org, orgId, "organization.setPublicMode", { id: orgId, isPublic: true }, owner))
	ok(yield* call(org, orgId, "organization.joinViaPublicInvite", { slug: "acme" }, member))
	const [general] = rows<{ id: ChannelId }>(org, `SELECT id FROM channels WHERE name = 'general'`)
	return { objects, org, orgId, owner, member, general: general!.id } satisfies World
})

/** `count` messages (with a reaction, a pin and an attachment on the first) in `channelId`'s object. */
const seedChannel = (world: World, channelId: ChannelId, count: number, prefix: string) =>
	Effect.gen(function* () {
		const channel = yield* world.objects.get(channelTarget(channelId))
		const ids: Array<string> = []
		for (let index = 0; index < count; index++) {
			const id = uuid()
			ids.push(id)
			exec(
				channel,
				`INSERT INTO messages (id, channelId, authorId, content) VALUES (?, ?, ?, ?)`,
				id,
				channelId,
				world.owner,
				`${prefix} ${index}`,
			)
		}
		const first = ids[0]!
		exec(
			channel,
			`INSERT INTO messages (id, channelId, authorId, content, deletedAt) VALUES (?, ?, ?, ?, ?)`,
			uuid(),
			channelId,
			world.owner,
			`${prefix} deleted`,
			"2026-01-01 00:00:00.000",
		)
		exec(
			channel,
			`INSERT INTO message_reactions (id, messageId, channelId, userId, emoji) VALUES (?, ?, ?, ?, ?)`,
			uuid(),
			first,
			channelId,
			world.member,
			"👍",
		)
		exec(
			channel,
			`INSERT INTO pinned_messages (id, channelId, messageId, pinnedBy) VALUES (?, ?, ?, ?)`,
			uuid(),
			channelId,
			first,
			world.owner,
		)
		exec(
			channel,
			`INSERT INTO attachments (id, organizationId, channelId, messageId, fileName, fileSize, uploadedBy, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 'complete')`,
			uuid(),
			world.orgId,
			channelId,
			first,
			`${prefix}.png`,
			42,
			world.owner,
		)
		return ids
	})

/** Run the org's alarm until no export is building (bounded). */
const drainExports = (world: World) =>
	Effect.gen(function* () {
		for (let step = 0; step < 200; step++) {
			const [active] = rows<{ n: number }>(
				world.org,
				`SELECT count(*) AS n FROM organization_exports WHERE status IN ('pending', 'running')`,
			)
			if (active!.n === 0) return step
			yield* world.org.alarm
		}
		throw new Error("The export never finished")
	})

interface ExportLine {
	readonly table: string
	readonly row: Record<string, unknown>
}

const readExport = (world: World, exportId: string, parts: number): Array<ExportLine> => {
	const lines: Array<ExportLine> = []
	for (let index = 0; index < parts; index++) {
		const body = world.objects.exportFiles.get(orgExportPartKey(world.orgId, exportId, index))
		if (body === undefined) throw new Error(`part ${index} is missing`)
		for (const text of body.split("\n")) if (text !== "") lines.push(JSON.parse(text))
	}
	return lines
}

const defaults = { ...exportTuning }
afterEach(() => {
	Object.assign(exportTuning, defaults)
})

describe("organization exports", () => {
	it("exports the org's and its channels' rows, without secrets", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const messages = yield* seedChannel(world, world.general, 3, "hello")
				// Secrets the export must never carry.
				const connectionId = uuid()
				exec(
					world.org,
					`INSERT INTO integration_connections (id, provider, organizationId, level, connectedBy, settings, metadata)
					 VALUES (?, 'linear', ?, 'organization', ?, ?, ?)`,
					connectionId,
					world.orgId,
					world.owner,
					JSON.stringify({ webhookSecret: "settings-secret" }),
					JSON.stringify({ apiKey: "metadata-secret" }),
				)
				exec(
					world.org,
					`INSERT INTO integration_tokens (id, connectionId, encryptedAccessToken, encryptedRefreshToken, iv)
					 VALUES (?, ?, 'access-token-secret', 'refresh-token-secret', 'iv-secret')`,
					uuid(),
					connectionId,
				)
				exec(
					world.org,
					`INSERT INTO channel_webhooks (id, channelId, organizationId, botUserId, name, tokenHash, tokenSuffix, createdBy)
					 VALUES (?, ?, ?, ?, 'Deploys', 'webhook-token-hash-secret', 'abcd', ?)`,
					uuid(),
					world.general,
					world.orgId,
					world.owner,
					world.owner,
				)

				const started = ok(
					yield* call(
						world.org,
						world.orgId,
						"organizationExport.start",
						{ organizationId: world.orgId },
						world.owner,
					),
				)
				expect(started.data.status).toBe("pending")
				// One export at a time.
				expect(
					errorTag(
						yield* call(
							world.org,
							world.orgId,
							"organizationExport.start",
							{ organizationId: world.orgId },
							world.owner,
						),
					),
				).toBe("OrganizationExportInProgressError")
				// The alarm is armed for it.
				expect(world.org.storage.alarm()).not.toBeNull()

				yield* drainExports(world)
				const [row] = rows<{
					status: string
					partCount: number
					rowCount: number
					channelCount: number
					channelsDone: number
				}>(
					world.org,
					`SELECT status, partCount, rowCount, channelCount, channelsDone FROM organization_exports WHERE id = ?`,
					started.data.id,
				)
				expect(row).toMatchObject({ status: "ready" })
				expect(row!.channelsDone).toBe(row!.channelCount)

				const lines = readExport(world, started.data.id, row!.partCount)
				const raw = [...world.objects.exportFiles.values()].join("")
				for (const secret of [
					"settings-secret",
					"metadata-secret",
					"access-token-secret",
					"refresh-token-secret",
					"iv-secret",
					"webhook-token-hash-secret",
					"@example.com",
				]) {
					expect(raw).not.toContain(secret)
				}
				expect(lines[0]).toMatchObject({ table: "export", row: { organizationId: world.orgId } })
				expect(lines.at(-1)).toMatchObject({ table: "end", row: { rowCount: row!.rowCount } })
				const byTable = (table: string) => lines.filter((each) => each.table === table)
				expect(byTable("organizations").map((each) => each.row.name)).toEqual(["Acme"])
				expect(byTable("organization_members")).toHaveLength(2)
				expect(
					byTable("users")
						.map((each) => each.row.firstName)
						.sort(),
				).toEqual(["Mel", "Olive"])
				expect(byTable("integration_tokens")).toHaveLength(0)
				expect(byTable("integration_connections").map((each) => each.row.provider)).toEqual([
					"linear",
				])
				expect(byTable("channel_webhooks").map((each) => each.row.name)).toEqual(["Deploys"])
				expect(byTable("channels").some((each) => each.row.id === world.general)).toBe(true)
				// Deleted messages stay out.
				expect(
					byTable("messages")
						.map((each) => each.row.id)
						.sort(),
				).toEqual([...messages].sort())
				expect(byTable("message_reactions")).toHaveLength(1)
				expect(byTable("pinned_messages")).toHaveLength(1)
				expect(byTable("attachments")).toHaveLength(1)
				expect(byTable("attachments")[0]!.row).toHaveProperty("publicUrl")
				// Every data line is counted.
				expect(lines.length - 2).toBe(row!.rowCount)

				// The signed download URL names the export and its parts.
				const download = ok(
					yield* call(
						world.org,
						world.orgId,
						"organizationExport.downloadUrl",
						{ organizationId: world.orgId, id: started.data.id },
						world.owner,
					),
				)
				expect(download.url).toContain(
					`/exports/${world.orgId}/${started.data.id}?parts=${row!.partCount}`,
				)
				expect(download.expiresAt).toBeGreaterThan(Date.now())
			}),
		))

	it("refuses members who are not owners or admins", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const startExit = yield* call(
					world.org,
					world.orgId,
					"organizationExport.start",
					{ organizationId: world.orgId },
					world.member,
				)
				expect(
					Exit.isFailure(startExit) &&
						Option.match(Cause.findErrorOption(startExit.cause), {
							onNone: () => false,
							onSome: (error) => error instanceof UnauthorizedError,
						}),
				).toBe(true)
				expect(
					errorTag(
						yield* call(
							world.org,
							world.orgId,
							"organizationExport.list",
							{ organizationId: world.orgId },
							world.member,
						),
					),
				).toBe("UnauthorizedError")
				const started = ok(
					yield* call(
						world.org,
						world.orgId,
						"organizationExport.start",
						{ organizationId: world.orgId },
						world.owner,
					),
				)
				expect(
					errorTag(
						yield* call(
							world.org,
							world.orgId,
							"organizationExport.downloadUrl",
							{ organizationId: world.orgId, id: started.data.id },
							world.member,
						),
					),
				).toBe("UnauthorizedError")
				// Not ready yet, even for the owner.
				expect(
					errorTag(
						yield* call(
							world.org,
							world.orgId,
							"organizationExport.downloadUrl",
							{ organizationId: world.orgId, id: started.data.id },
							world.owner,
						),
					),
				).toBe("OrganizationExportUnavailableError")
				const listed = ok(
					yield* call(
						world.org,
						world.orgId,
						"organizationExport.list",
						{ organizationId: world.orgId },
						world.owner,
					),
				)
				expect(listed.data.map((each: { id: string }) => each.id)).toEqual([started.data.id])
			}),
		))

	it("pages through many channels and threads across steps and parts", () =>
		run(
			Effect.gen(function* () {
				Object.assign(exportTuning, { orgPage: 2, channelPage: 2, partBytes: 600 })
				const world = yield* makeWorld
				const channels: Array<ChannelId> = [world.general]
				for (let index = 0; index < 3; index++) {
					const id = uuid() as ChannelId
					ok(
						yield* call(
							world.org,
							world.orgId,
							"channel.create",
							{
								id,
								name: `room-${index}`,
								icon: null,
								type: "public",
								organizationId: world.orgId,
								parentChannelId: null,
								sectionId: null,
							},
							world.owner,
						),
					)
					channels.push(id)
				}
				const expected: Array<string> = []
				for (const [index, channelId] of channels.entries()) {
					expected.push(...(yield* seedChannel(world, channelId, 5, `room ${index}`)))
				}
				const started = ok(
					yield* call(
						world.org,
						world.orgId,
						"organizationExport.start",
						{ organizationId: world.orgId },
						world.owner,
					),
				)
				const steps = yield* drainExports(world)
				const [row] = rows<{
					status: string
					partCount: number
					channelCount: number
					channelsDone: number
				}>(
					world.org,
					`SELECT status, partCount, channelCount, channelsDone FROM organization_exports WHERE id = ?`,
					started.data.id,
				)
				expect(row).toMatchObject({ status: "ready", channelsDone: row!.channelCount })
				expect(row!.channelCount).toBeGreaterThanOrEqual(channels.length)
				expect(row!.partCount).toBeGreaterThan(1)
				expect(steps).toBeGreaterThan(1)
				const lines = readExport(world, started.data.id, row!.partCount)
				const messageIds = lines
					.filter((each) => each.table === "messages")
					.map((each) => each.row.id)
				// Every message once, none twice.
				expect([...messageIds].sort()).toEqual([...expected].sort())
				expect(lines.filter((each) => each.table === "attachments")).toHaveLength(channels.length)
				expect(lines.filter((each) => each.table === "channels").map((each) => each.row.id)).toEqual(
					expect.arrayContaining(channels),
				)
			}),
		))
})
