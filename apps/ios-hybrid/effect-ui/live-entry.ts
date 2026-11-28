// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * G3: `@hazel/client-data` in a bare JavaScriptCore context over the Swift platform services
 * (`EffectUiSpike/Platform/`), driving the `hazel` channel list from live queries. Asks `user.me`
 * over RPC (URLSession), opens the user's sync session (URLSessionWebSocketTask) and mounts.
 */
import { shimmed } from "./live-globals"
import { Renderer } from "@effect/ui"
import type { OrganizationId } from "@hazel/schema"
import { Effect, Layer, Option, Stream } from "effect"
import { ClientData } from "../../../packages/client-data/src/client.ts"
import { PlatformJsc } from "../../../packages/client-data/src/platform/jsc/index.ts"
import { HazelRpc, HazelRpcLayer } from "../../../packages/client-data/src/rpc.ts"
import { makeNativeHost } from "../../../packages/ui/src/native/host.ts"
import { type Json, WIRE_VERSION } from "../../../packages/ui/src/native/wire.ts"
import { Dms, dmsLayer } from "../../shared-screens/src/dms/Dms.ts"
import { makeLiveChannelList } from "./live-channel-list"
import { type SidebarRows, sidebarSections } from "./live-sections"

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

	// The screens themselves run in the native app (`script/entry.ts`); this spike keeps the G3 list
	// and the DMs screen (`-HazelScreen dms`).
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
		client.liveQueryStream(
			(q) => q.from({ row: c.userCollection }),
			(rows: SidebarRows["users"]) => rows,
		),
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

	// `-HazelScreen <name>`: a shared screen on live data instead of the channel list.
	if (__native.screen === "dms") {
		const org = yield* client
			.liveQueryStream(
				(q) => q.from({ row: c.organizationCollection }),
				(rows: ReadonlyArray<{ id: OrganizationId; slug: string | null }>) => rows[0],
			)
			.pipe(
				Stream.filter((row) => row !== undefined),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
			)
		yield* Renderer.mount(
			Dms,
			{ organizationId: org.id, userId: me.id, orgSlug: org.slug ?? "", nowMs: Date.now() },
			native.container,
		).pipe(
			Effect.provide(
				dmsLayer(
					client,
					(id) => Effect.sync(() => console.log(`[live] open DM ${id}`)),
					Effect.sync(() => console.log("[live] compose")),
				),
			),
		)
	} else yield* Renderer.mount(makeLiveChannelList(sections), {}, native.container)
	return yield* Effect.never
})

program.pipe(
	Effect.provide(
		Layer.mergeAll(
			Layer.mergeAll(ClientData.layer, HazelRpcLayer).pipe(Layer.provideMerge(PlatformJsc)),
			native.layer,
		),
	),
	Effect.scoped,
	Effect.tapCause((cause) => Effect.sync(() => console.error(`[live] failed: ${String(cause)}`))),
	Effect.runFork,
)

Object.assign(globalThis, {
	__hazel: {
		version: WIRE_VERSION,
		fire: (id: number, event: string, payload: string) =>
			// SAFETY: the shell sends `payload` as JSON.stringify of a plain object (`TreeHost`).
			native.fire(id, event, JSON.parse(payload) as Json),
	},
})
