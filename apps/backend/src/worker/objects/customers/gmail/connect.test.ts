/**
 * Gmail connections in the object: `customers.gmailConnect` (members only, one connection per
 * mailbox, a reconnect that lifts the error and keeps the data), and who may change one afterwards
 * (the member who connected it, or an admin; nobody through the API-key connect).
 */
import type { CustomerConnectionId, UserId } from "@hazel/schema"
import { ConfigProvider, Effect, Exit, Layer, Option, Redacted, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { IntegrationEncryption } from "../../../../services/integration-encryption"
import { loadCredentials } from "../credentials"
import { CustomerIngest } from "../ingest"
import { type CustomersWorld, makeCustomersWorld, tagOf, uuid } from "../test-kit"
import { connectGmailWith } from "./connect"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const encryption = IntegrationEncryption.layer.pipe(
	Layer.provide(
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({ INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64") }),
		),
	),
)

const connect = (world: CustomersWorld, userId: UserId, mailbox: string, refreshToken = "1//token") =>
	world.object
		.run(
			connectGmailWith(Layer.mergeAll(CustomerIngest.layer, encryption))({
				organizationId: world.orgId,
				userId,
				mailbox,
				refreshToken,
			}).pipe(Effect.exit),
		)
		.pipe(Effect.orDie)

const connections = (world: CustomersWorld) =>
	world.rows<{ id: string; externalAccountId: string; connectedBy: string; status: string }>(
		`SELECT id, externalAccountId, connectedBy, status FROM customer_connections WHERE provider = 'gmail'
		 ORDER BY externalAccountId`,
	)

const tokenOf = (world: CustomersWorld, id: string) =>
	world.object
		.run(
			Effect.gen(function* () {
				const rows = world.rows<{ config: string; externalAccountId: string }>(
					`SELECT config, externalAccountId FROM customer_connections WHERE id = ?`,
					id,
				)
				const credentials = yield* loadCredentials({
					id: id as CustomerConnectionId,
					config: JSON.parse(rows[0]!.config),
					externalAccountId: rows[0]!.externalAccountId,
				})
				return Option.map(credentials, (value) => Redacted.value(value.apiKey))
			}).pipe(Effect.provide(encryption)),
		)
		.pipe(Effect.orDie)

describe("Gmail connect", () => {
	it("connects a member's mailbox and starts its backfill; refuses a stranger", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const exit = yield* connect(world, world.member, "ada@hazel.sh")
				expect(Exit.isSuccess(exit)).toBe(true)
				const [row] = connections(world)
				expect(row).toMatchObject({
					externalAccountId: "ada@hazel.sh",
					connectedBy: world.member,
					status: "active",
				})
				expect(
					world.rows(
						`SELECT trigger, status FROM customer_sync_runs WHERE connectionId = ?`,
						row!.id,
					),
				).toEqual([{ trigger: "backfill", status: "running" }])
				expect(yield* tokenOf(world, row!.id)).toEqual(Option.some("1//token"))

				const refused = yield* connect(world, world.stranger, "eve@hazel.sh")
				expect(
					Exit.isFailure(refused) && Option.getOrNull(Exit.findErrorOption(refused)),
				).toMatchObject({
					reason: "forbidden",
				})
				expect(connections(world)).toHaveLength(1)
			}),
		))

	it("holds one connection per mailbox, and a reconnect lifts the error without wiping data", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* connect(world, world.member, "ada@hazel.sh")
				yield* connect(world, world.owner, "lin@hazel.sh")
				const [ada] = connections(world)
				world.object.storage.db
					.prepare(
						`UPDATE customer_connections SET status = 'error', lastError = '{"code":"auth","message":"x","httpStatus":400}' WHERE id = ?`,
					)
					.run(ada!.id)
				world.object.storage.db
					.prepare(
						`INSERT INTO customer_emails (id, provider, messageId, mailbox, externalId, threadId, direction,
						 fromAddress, subject, snippet, bodyText, occurredAt) VALUES (?, 'gmail', 'kept', 'ada@hazel.sh', 'x', 't',
						 'inbound', '{"email":"a@b.co","name":null}', 's', 's', 'b', '2026-06-01 00:00:00.000')`,
					)
					.run(uuid())

				yield* connect(world, world.member, "ada@hazel.sh", "1//new-token")

				expect(connections(world).map((row) => [row.externalAccountId, row.status])).toEqual([
					["ada@hazel.sh", "active"],
					["lin@hazel.sh", "active"],
				])
				expect(connections(world)[0]?.id).toBe(ada!.id)
				// A nullable JSON column stores the document `null`.
				const [lifted] = world.rows<{ lastError: string | null }>(
					`SELECT lastError FROM customer_connections WHERE id = ?`,
					ada!.id,
				)
				expect(JSON.parse(lifted?.lastError ?? "null")).toBeNull()
				expect(yield* tokenOf(world, ada!.id)).toEqual(Option.some("1//new-token"))
				expect(world.rows(`SELECT messageId FROM customer_emails`)).toEqual([{ messageId: "kept" }])
			}),
		))
})

describe("Gmail connection authorization", () => {
	it("lets the member who connected a mailbox sync, update and disconnect it, and admins any", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const own = world.connectGmail("ada@hazel.sh", world.member)
				const owners = world.connectGmail("lin@hazel.sh", world.owner)
				const as = (
					tag: Parameters<CustomersWorld["call"]>[0],
					payload: Record<string, unknown>,
					user: UserId,
				) => world.call(tag, payload, user).pipe(Effect.map(tagOf))

				expect(yield* as("customers.connection.syncNow", { connectionId: own }, world.member)).toBe(
					"Success",
				)
				expect(
					yield* as(
						"customers.connection.update",
						{ connectionId: own, config: { _tag: "gmail", lookbackDays: 30 } },
						world.member,
					),
				).toBe("Success")
				expect(
					yield* as("customers.connection.syncNow", { connectionId: owners }, world.member),
				).toBe("UnauthorizedError")
				expect(
					yield* as("customers.connection.disconnect", { connectionId: owners }, world.member),
				).toBe("UnauthorizedError")
				// Another provider's connection stays admin-only, even for the member who made it.
				expect(
					yield* as(
						"customers.connection.syncNow",
						{ connectionId: world.connection("maple") },
						world.member,
					),
				).toBe("UnauthorizedError")
				expect(
					yield* as("customers.connection.disconnect", { connectionId: own }, world.member),
				).toBe("Success")
				expect(
					yield* as("customers.connection.disconnect", { connectionId: owners }, world.owner),
				).toBe("Success")
				expect(
					world.rows(`SELECT status FROM customer_connections WHERE provider = 'gmail'`),
				).toEqual([{ status: "disconnected" }, { status: "disconnected" }])
			}),
		))

	it("refuses an API key for Gmail, on connect and on update", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const own = world.connectGmail("ada@hazel.sh", world.member)
				const connect = yield* world.call(
					"customers.connection.connect",
					{
						provider: "gmail",
						apiKey: "x",
						webhookSecret: null,
						config: { _tag: "gmail", lookbackDays: 90 },
					},
					world.owner,
				)
				const update = yield* world.call(
					"customers.connection.update",
					{ connectionId: own, apiKey: "x" },
					world.member,
				)
				expect([tagOf(connect), tagOf(update)]).toEqual([
					"CustomersInvalidRequestError",
					"CustomersInvalidRequestError",
				])
			}),
		))
})
