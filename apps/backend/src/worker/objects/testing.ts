/**
 * Objects on node SQLite, for tests: every object an in-memory `ObjectRuntime` over
 * `@hazel/sync-do/testing`'s fake storage, wired to each other through `ObjectStubs` (so outbox
 * deliveries really cross objects), one shared directory database, and a bot gateway that
 * records what it was sent.
 */
import type { BotGatewayEnvelope } from "@hazel/domain"
import type { StoreMigration } from "@hazel/db"
import { layerMemory } from "@hazel/db/node"
import type { BotId } from "@hazel/schema"
import { type FakeStorage, makeFakeState, makeFakeStorage, sqliteClientLayer } from "@hazel/sync-do/testing"
import { ConfigProvider, Context, Deferred, Effect, type Exit, Layer, Option, Scope } from "effect"
import { Persistence } from "effect/persistence"
import { BotGatewayTransport } from "../../services/bot-gateway-transport"
import { Directory } from "../../services/directory"
import { HtmlRenderStore, HtmlRenders } from "../../services/html-renders"
import { InviteMailer } from "../../services/invite-mailer"
import { ThreadNamer, type ThreadNamingContext } from "../../services/thread-namer"
import {
	type ChatSyncCall,
	makeRecordingChatSyncTransport,
} from "../../services/chat-sync/chat-sync-transport"
import { makeRpcDispatcher, type RpcDispatcherShape } from "../../rpc/dispatch"
import { objectHandlersLive } from "./handlers"
import type { InvokePrincipal } from "./principal"
import { formatTarget, type ObjectTarget } from "./kinds"
import { ObjectStubs } from "./protocol"
import { makeObjectRuntime, type ObjectRuntime } from "./runtime"

/** Config the app services read while they build; values are inert placeholders. */
const TEST_CONFIG = {
	S3_BUCKET: "test",
	S3_ENDPOINT: "http://localhost:9000",
	S3_ACCESS_KEY_ID: "test",
	S3_SECRET_ACCESS_KEY: "test",
	// 32 bytes, base64 (AES-256).
	INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
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
	/**
	 * Hold deliveries to `target` until `release`; `reached` completes when one is waiting (a
	 * drain that can't finish, as a slow object would make it).
	 */
	readonly hold: (target: ObjectTarget) => {
		readonly reached: Effect.Effect<void>
		readonly release: Effect.Effect<void>
	}
	/** The stubs the objects reach each other through (for callers outside the objects). */
	readonly stubs: Context.Service.Shape<typeof ObjectStubs>
	/** Provider calls chat-sync deliveries made (`chatSync.outbound`), in order. */
	readonly chatSyncCalls: Array<ChatSyncCall>
	/** Make provider calls fail with `status` (retryable for 429/5xx), or succeed again (undefined). */
	readonly setChatSyncFailure: (status: number | undefined) => void
	/** What `ThreadNamer` was asked to name, in order. */
	readonly namingRequests: Array<ThreadNamingContext>
	/** The name `ThreadNamer` answers (default `"Generated name"`). */
	readonly setThreadName: (name: string) => void
	/** The uploads bucket's objects (HTML renders), by key. */
	readonly bucket: Map<string, string>
	/** Run `tag` (decoded payload) on the directory path, as the api Worker does for D1 methods. */
	readonly invokeDirectory: (
		tag: string,
		payload: unknown,
		principal: InvokePrincipal,
	) => Effect.Effect<Exit.Exit<unknown, unknown>>
}

export interface TestObjectsOptions {
	/** Each kind's migrations, in place of its store's (`storeMigrations`). */
	readonly migrations?: Partial<Record<ObjectTarget["kind"], ReadonlyArray<StoreMigration>>>
}

export const makeTestObjectsWith = (options: TestObjectsOptions = {}) =>
	Effect.gen(function* () {
		const scope = yield* Scope.Scope
		const directoryDatabase = yield* Layer.build(layerMemory)
		const directory = yield* Layer.build(
			Directory.layerDatabase.pipe(Layer.provide(Layer.succeedContext(directoryDatabase))),
		)
		const published: TestObjects["published"] = []
		const deliveries: Array<string> = []
		const unreachable = new Set<string>()
		const held = new Map<string, { reached: Deferred.Deferred<void>; gate: Deferred.Deferred<void> }>()
		const objects = new Map<string, TestObject>()
		const namingRequests: Array<ThreadNamingContext> = []
		let threadName = "Generated name"

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
				invoke: (request) =>
					isolated(Effect.flatMap(get(target), (object) => object.invoke(request))),
				call: (request) =>
					isolated(
						Effect.flatMap(get(target), (object) => object.call(structuredClone(request))),
					).pipe(Effect.map((response) => structuredClone(response))),
				applyEffect: (request) =>
					Effect.suspend(() => {
						if (unreachable.has(formatTarget(target))) {
							return Effect.fail(new Error(`${formatTarget(target)} is unreachable`))
						}
						const hold = held.get(formatTarget(target))
						const wait =
							hold === undefined
								? Effect.void
								: Effect.andThen(
										Deferred.succeed(hold.reached, undefined),
										Deferred.await(hold.gate),
									)
						return wait.pipe(
							Effect.andThen(
								Effect.sync(() =>
									deliveries.push(`${formatTarget(target)} ${request.kind} ${request.key}`),
								),
							),
							Effect.andThen(
								isolated(
									Effect.flatMap(get(target), (object) => object.applyEffect(request)),
								),
							),
						)
					}),
			}),
		}

		const threadNamer = Layer.succeed(
			ThreadNamer,
			ThreadNamer.of({
				name: (context) =>
					Effect.sync(() => {
						namingRequests.push(context)
						return Option.some(threadName)
					}),
			}),
		)

		const chatSync = makeRecordingChatSyncTransport({ attachmentPublicUrlBase: "https://files.test" })
		// The real service over an in-memory bucket.
		const bucket = new Map<string, string>()
		const htmlRenderStore = Layer.succeed(HtmlRenderStore, {
			put: (key, html) => Effect.sync(() => void bucket.set(key, html)),
			getText: (key) => Effect.sync(() => Option.fromNullishOr(bucket.get(key))),
			remove: (key) => Effect.sync(() => void bucket.delete(key)),
		})
		const htmlRenders = HtmlRenders.layer.pipe(
			Layer.provide(htmlRenderStore),
			Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(TEST_CONFIG))),
			Layer.orDie,
		)
		const platform = Layer.mergeAll(
			Layer.succeedContext(directory),
			Layer.succeed(ObjectStubs, stubs),
			transport,
			threadNamer,
			chatSync.layer,
			htmlRenders,
		)

		const appPlatform = Layer.mergeAll(
			Persistence.layerMemory,
			htmlRenderStore,
			// Logs links (IS_DEV) instead of sending.
			InviteMailer.layerLog.pipe(
				Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(TEST_CONFIG))),
			),
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
				...(options.migrations?.[target.kind] === undefined
					? {}
					: { migrations: options.migrations[target.kind] }),
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
				return create(target).pipe(
					Effect.tap((object) => Effect.sync(() => objects.set(key, object))),
				)
			})

		/** The api Worker's directory path: the handlers in process over the directory database. */
		let directoryDispatcher: RpcDispatcherShape | undefined
		const directoryPath = Effect.suspend(() =>
			directoryDispatcher !== undefined
				? Effect.succeed(directoryDispatcher)
				: Layer.build(
						objectHandlersLive.pipe(
							Layer.provide(appPlatform),
							Layer.provide(platform),
							Layer.provide(Layer.succeedContext(directoryDatabase)),
							Layer.orDie,
						),
					).pipe(
						Effect.flatMap((handlers) => makeRpcDispatcher.pipe(Effect.provideContext(handlers))),
						Effect.tap((dispatcher) =>
							Effect.sync(() => void (directoryDispatcher = dispatcher)),
						),
						Effect.provideService(Scope.Scope, scope),
					),
		)

		return {
			get,
			bucket,
			invokeDirectory: (tag, payload, principal) =>
				isolated(
					Effect.flatMap(directoryPath, (dispatcher) =>
						dispatcher.dispatch(tag, payload, principal),
					),
				),
			directory,
			published,
			deliveries,
			setUnreachable: (target, value) => {
				if (value) unreachable.add(formatTarget(target))
				else unreachable.delete(formatTarget(target))
			},
			hold: (target) => {
				const entry = { reached: Deferred.makeUnsafe<void>(), gate: Deferred.makeUnsafe<void>() }
				held.set(formatTarget(target), entry)
				return {
					reached: Deferred.await(entry.reached),
					release: Effect.andThen(
						Effect.sync(() => held.delete(formatTarget(target))),
						Deferred.succeed(entry.gate, undefined),
					).pipe(Effect.asVoid),
				}
			},
			stubs,
			chatSyncCalls: chatSync.calls,
			setChatSyncFailure: (status) => {
				chatSync.control.fail = status
			},
			namingRequests,
			setThreadName: (name) => {
				threadName = name
			},
		} satisfies TestObjects
	})

/** Objects over the stores' own migrations. */
export const makeTestObjects = makeTestObjectsWith()
