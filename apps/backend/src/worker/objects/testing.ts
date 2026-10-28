/**
 * Objects on node SQLite, for tests: every object an in-memory `ObjectRuntime` over
 * `@hazel/sync-do/testing`'s fake storage, wired to each other through `ObjectStubs` (so outbox
 * deliveries really cross objects), one shared directory database, and a bot gateway that
 * records what it was sent.
 */
import type { BotGatewayEnvelope } from "@hazel/domain"
import { layerMemory } from "@hazel/db/node"
import type { BotId } from "@hazel/schema"
import { type FakeStorage, makeFakeState, makeFakeStorage, sqliteClientLayer } from "@hazel/sync-do/testing"
import { ConfigProvider, Context, Effect, Layer, Scope } from "effect"
import { Persistence } from "effect/persistence"
import { BotGatewayTransport } from "../../services/bot-gateway-transport"
import { Directory } from "../../services/directory"
import { InviteMailer } from "../../services/invite-mailer"
import { objectHandlersLive } from "./handlers"
import { formatTarget, type ObjectTarget } from "./kinds"
import { ObjectStubs } from "./protocol"
import { makeObjectRuntime, type ObjectRuntime } from "./runtime"

/** Config the app services read while they build; values are inert placeholders. */
const TEST_CONFIG = {
	S3_BUCKET: "test",
	S3_ENDPOINT: "http://localhost:9000",
	S3_ACCESS_KEY_ID: "test",
	S3_SECRET_ACCESS_KEY: "test",
	INTEGRATION_ENCRYPTION_KEY: "0".repeat(64),
	CLUSTER_URL: "http://localhost:3020",
	API_BASE_URL: "http://localhost:3003",
	FRONTEND_URL: "http://localhost:3100",
	IS_DEV: "true",
	GITHUB_APP_PRIVATE_KEY: "test",
	GITHUB_APP_SLUG: "test",
	GITHUB_APP_ID: "test",
}

export type TestObject = ObjectRuntime & {
	readonly storage: FakeStorage
	readonly state: ReturnType<typeof makeFakeState>
}

export interface TestObjects {
	/** The object for `target`, created (and migrated) on first use. */
	readonly get: (target: ObjectTarget) => Effect.Effect<TestObject>
	readonly directory: Context.Context<Directory>
	/** Envelopes appended to each bot's gateway. */
	readonly published: Array<{ readonly botId: BotId; readonly envelope: BotGatewayEnvelope }>
	/** `applyEffect` calls that crossed objects, as `target kind key`. */
	readonly deliveries: Array<string>
	/** Make deliveries to `target` fail (outbox retry), or succeed again. */
	readonly setUnreachable: (target: ObjectTarget, unreachable: boolean) => void
}

export const makeTestObjects = Effect.gen(function* () {
	const scope = yield* Scope.Scope
	const directory = yield* Layer.build(Directory.layerDatabase.pipe(Layer.provide(layerMemory)))
	const published: TestObjects["published"] = []
	const deliveries: Array<string> = []
	const unreachable = new Set<string>()
	const objects = new Map<string, TestObject>()

	const transport = Layer.succeed(
		BotGatewayTransport,
		BotGatewayTransport.of({
			append: (botId, envelope) => Effect.sync(() => void published.push({ botId, envelope })),
		}),
	)

	/** A DO call starts from a clean context, as a real one (another isolate) would. */
	const isolated = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
		effect.pipe(Effect.updateContext(() => Context.empty())) as Effect.Effect<A, E>

	const stubs: Context.Service.Shape<typeof ObjectStubs> = {
		get: (target) => ({
			invoke: (request) => isolated(Effect.flatMap(get(target), (object) => object.invoke(request))),
			applyEffect: (request) =>
				Effect.suspend(() => {
					if (unreachable.has(formatTarget(target))) {
						return Effect.fail(new Error(`${formatTarget(target)} is unreachable`))
					}
					deliveries.push(`${formatTarget(target)} ${request.kind} ${request.key}`)
					return isolated(Effect.flatMap(get(target), (object) => object.applyEffect(request)))
				}),
		}),
	}

	const platform = Layer.mergeAll(
		Layer.succeedContext(directory),
		Layer.succeed(ObjectStubs, stubs),
		transport,
	)

	const appPlatform = Layer.mergeAll(
		Persistence.layerMemory,
		InviteMailer.layerLog,
		ConfigProvider.layer(ConfigProvider.fromUnknown(TEST_CONFIG)),
	)

	const create = (target: ObjectTarget) => {
		const storage = makeFakeStorage()
		const state = makeFakeState()
		return makeObjectRuntime({
			kind: target.kind,
			storage,
			state,
			sql: sqliteClientLayer(storage),
			handlers: objectHandlersLive.pipe(Layer.provide(appPlatform), Layer.orDie),
			platform,
		}).pipe(
			Effect.map((object): TestObject => ({ ...object, storage, state })),
			Effect.provideService(Scope.Scope, scope),
		)
	}

	const get = (target: ObjectTarget): Effect.Effect<TestObject> =>
		Effect.suspend(() => {
			const key = formatTarget(target)
			const existing = objects.get(key)
			if (existing !== undefined) return Effect.succeed(existing)
			return create(target).pipe(Effect.tap((object) => Effect.sync(() => objects.set(key, object))))
		})

	return {
		get,
		directory,
		published,
		deliveries,
		setUnreachable: (target, value) => {
			if (value) unreachable.add(formatTarget(target))
			else unreachable.delete(formatTarget(target))
		},
	} satisfies TestObjects
})
