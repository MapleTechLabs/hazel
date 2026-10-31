import { createHash } from "node:crypto"
import { BotRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import type { BotId, OrganizationId, UserId } from "@hazel/schema"
import { ConfigProvider, Context, Effect, Exit, Layer, Option } from "effect"
import { HttpServerRequest } from "effect/http"
import { describe, expect, it } from "vitest"
import { Directory } from "../services/directory"
import { IntegrationEncryption } from "../services/integration-encryption"
import { makeTestObjects } from "../worker/objects/testing"
import {
	checkCallback,
	openPending,
	requireT3CodeBot,
	sealPending,
	T3CODE_BOT_EXTERNAL_ID,
} from "./t3code.http"

const alice = "alice" as UserId
const flow = {
	userId: alice,
	state: "state-1",
	issuer: "https://mac.t3.example",
	tokenEndpoint: "https://mac.t3.example/oauth/mcp/token",
	environmentUrl: "https://mac.t3.example",
}

describe("T3 Code OAuth callback", () => {
	it("finishes only for the member who started, with their state", () => {
		expect(checkCallback(flow, { code: "c", state: "state-1", iss: flow.issuer }, alice)).toEqual({
			_tag: "ok",
			code: "c",
		})
		expect(
			checkCallback(flow, { code: "c", state: "state-1", iss: flow.issuer }, "mallory" as UserId),
		).toEqual({
			_tag: "refused",
			error: "invalid_state",
		})
		expect(checkCallback(flow, { code: "c", state: "other" }, alice)).toMatchObject({
			error: "invalid_state",
		})
		expect(checkCallback(flow, { code: "c" }, alice)).toMatchObject({ error: "invalid_state" })
	})

	it("refuses a code from another issuer (mix-up), or without one", () => {
		expect(checkCallback(flow, { code: "c", state: "state-1" }, alice)).toMatchObject({
			error: "invalid_state",
		})
		expect(
			checkCallback(flow, { code: "c", state: "state-1", iss: "https://evil.example" }, alice),
		).toMatchObject({
			error: "invalid_state",
		})
	})

	it("refuses a token endpoint off the environment", () => {
		const moved = { ...flow, tokenEndpoint: "https://internal.example/token" }
		expect(checkCallback(moved, { code: "c", state: "state-1", iss: flow.issuer }, alice)).toMatchObject({
			error: "invalid_state",
		})
	})

	it("reports a declined sign-in", () => {
		expect(
			checkCallback(flow, { error: "access_denied", state: "state-1", iss: flow.issuer }, alice),
		).toEqual({
			_tag: "refused",
			error: "denied",
		})
	})
})

describe("T3 Code pending sign-in cookie", () => {
	const encryption = IntegrationEncryption.layer.pipe(
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
				}),
			),
		),
	)
	const pending = {
		state: "state-1",
		codeVerifier: "v".repeat(64),
		clientId: "client",
		tokenEndpoint: "https://mac.t3.example/oauth/mcp/token",
		issuer: "https://mac.t3.example",
		environmentUrl: "https://mac.t3.example",
		environmentId: "env-1",
		environmentLabel: "Alice's MacBook",
		organizationId: "00000000-0000-4000-8000-000000000001" as OrganizationId,
		userId: "00000000-0000-4000-8000-000000000002" as UserId,
		returnTo: "http://localhost:3100/acme/settings/integrations/t3code",
		createdAt: 1,
	}

	it("round-trips sealed, and hides the verifier", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const sealed = yield* sealPending(pending)
				expect(decodeURIComponent(sealed)).not.toContain(pending.codeVerifier)
				expect(yield* openPending(sealed)).toEqual(Option.some(pending))
			}).pipe(Effect.provide(encryption)),
		))

	it("refuses a cookie a member wrote, or one mangled elsewhere", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const forged = encodeURIComponent(JSON.stringify({ ...pending, organizationId: "other" }))
				expect(yield* openPending(forged)).toEqual(Option.none())
				const sealed = decodeURIComponent(yield* sealPending(pending))
				const [version, iv, ciphertext] = sealed.split(".")
				const tampered = `${version}.${iv}.${ciphertext!.slice(0, -4)}AAAA`
				expect(yield* openPending(encodeURIComponent(tampered))).toEqual(Option.none())
				expect(yield* openPending("%E0%A4%A")).toEqual(Option.none())
			}).pipe(Effect.provide(encryption)),
		))
})

describe("requireT3CodeBot", () => {
	const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

	/** A bot whose directory user has `externalId`, and its token. */
	const asBot = (externalId: string) =>
		Effect.gen(function* () {
			const objects = yield* makeTestObjects
			const directory = Context.get(objects.directory, Directory)
			const userId = crypto.randomUUID() as UserId
			const token = `hzl_bot_${crypto.randomUUID()}`
			yield* directory.db.run(
				SQLite.insertInto(schema.usersTable).values({
					id: userId,
					externalId,
					email: `${externalId}@bots.test`,
					firstName: "Bot",
					lastName: "",
					userType: "machine",
				}),
			)
			yield* directory.db.run(
				SQLite.insertInto(schema.botsTable).values({
					id: crypto.randomUUID() as BotId,
					userId,
					createdBy: alice,
					name: externalId,
					apiTokenHash: sha256(token),
				}),
			)
			return yield* requireT3CodeBot.pipe(
				Effect.provideService(
					HttpServerRequest.HttpServerRequest,
					HttpServerRequest.fromWeb(
						new Request("http://localhost/integrations/t3code/bot/access", {
							headers: { authorization: `Bearer ${token}` },
						}),
					),
				),
				Effect.provide(
					BotRepo.layer.pipe(Layer.provide(Layer.succeed(Database.Database, directory.db))),
				),
				Effect.provideContext(objects.directory),
				Effect.exit,
			)
		}).pipe(Effect.scoped, Effect.orDie)

	it("admits only the seeded T3 Code bot", async () => {
		expect(Exit.isSuccess(await Effect.runPromise(asBot(T3CODE_BOT_EXTERNAL_ID)))).toBe(true)
		const other = await Effect.runPromise(asBot("a-members-own-bot"))
		expect(Exit.isFailure(other) && JSON.stringify(other.cause)).toContain("Only the T3 Code bot")
	})
})
