// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * G3: `@hazel/client-data` in a bare JavaScriptCore context over the Swift platform services
 * (`EffectUiSpike/Platform/`), driving the `hazel` channel list from live queries. Asks `user.me`
 * over RPC (URLSession), opens the user's sync session (URLSessionWebSocketTask) and mounts.
 */
import { shimmed } from "./live-globals"
import { Renderer } from "@effect/ui"
import { Effect, Layer, Stream } from "effect"
import { ClientData } from "../../../packages/client-data/src/client.ts"
import { PlatformJsc } from "../../../packages/client-data/src/platform/jsc/index.ts"
import { HazelRpc, HazelRpcLayer } from "../../../packages/client-data/src/rpc.ts"
import { makeNativeHost } from "../../../packages/ui/src/native/host.ts"
import { type Json, WIRE_VERSION } from "../../../packages/ui/src/native/wire.ts"
import { makeLiveChannelList } from "./live-channel-list"
import { type SidebarRows, sidebarSections } from "./live-sections"
import { mountChannelSidebarNative } from "../../shared-screens/src/channel-sidebar/native.ts"

declare const __native: { post: (json: string) => void; screen?: string }

const native = makeNativeHost((batch) => __native.post(JSON.stringify(batch)))
const started = Date.now()
const since = () => `${Date.now() - started} ms`

const program = Effect.gen(function* () {
	console.log(`[live] shims installed: ${shimmed.join(", ") || "none"}`)
	const client = yield* ClientData
	const rpc = yield* HazelRpc
	const me = yield* rpc("user.me", undefined)
	console.log(`[live] user.me over HTTP: ${me.id} (${since()})`)
	yield* Stream.runDrain(client.syncSession(me.id)).pipe(Effect.forkScoped)

	// The Phase 3 screens, by launch arg (`-HazelScreen <name>`); the G3 list otherwise.
	switch (__native.screen) {
		case "sidebar":
			yield* mountChannelSidebarNative(native.container, me.id)
			return yield* Effect.never
	}

	const { collections: c } = client
	const sections = Stream.zipLatestAll(
		client.liveQueryStream(
			(q) => q.from({ row: c.channelCollection }),
			(rows: SidebarRows["channels"]) => rows,
		),
		client.liveQueryStream(
			(q) => q.from({ row: c.channelSectionCollection }),
			(rows: SidebarRows["sections"]) => rows,
		),
		client.liveQueryStream(
			(q) => q.from({ row: c.channelMemberCollection }),
			(rows: SidebarRows["members"]) => rows,
		),
		client.liveQueryStream((q) => q.from({ row: c.userCollection }), (rows: SidebarRows["users"]) => rows),
	).pipe(
		Stream.map(([channels, sections, members, users]) =>
			sidebarSections(me.id, { channels, sections, members, users }),
		),
		Stream.tap((next) =>
			Effect.sync(() =>
				console.log(
					`[live] sidebar: ${next.map((s) => `${s.title}(${s.channels.length})`).join(" ")} (${since()})`,
				),
			),
		),
	)

	yield* Renderer.mount(makeLiveChannelList(sections), {}, native.container)
	return yield* Effect.never
})

program.pipe(
	Effect.provide(
		Layer.mergeAll(Layer.mergeAll(ClientData.layer, HazelRpcLayer).pipe(Layer.provide(PlatformJsc)), native.layer),
	),
	Effect.scoped,
	Effect.tapCause((cause) => Effect.sync(() => console.error(`[live] failed: ${String(cause)}`))),
	Effect.runFork,
)

Object.assign(globalThis, {
	__hazel: {
		version: WIRE_VERSION,
		fire: (id: number, event: string, payload: string) => native.fire(id, event, JSON.parse(payload) as Json),
	},
})
