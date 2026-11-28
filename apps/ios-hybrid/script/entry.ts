// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The native app's script (`Hazel/AppRuntime.swift`, `docs/ios-native.md`): the shared `hazel`
 * screens in JavaScriptCore, drawn by HazelUI. Signs in first when the keychain holds no session,
 * then mounts the root. A route with no native screen yet opens in the shell's web fallback.
 */
import { shimmed } from "../effect-ui/live-globals"
import { Renderer } from "@effect/ui"
import { ClientData, HazelRpc, HazelRpcLayer } from "@hazel/client-data"
import { SignInPage } from "@hazel/shared-screens/auth/pages/sign-in/SignInPage"
import { sidebarWritesLayer } from "@hazel/shared-screens/channel-sidebar/actions"
import {
	ChannelSidebar,
	channelSidebarLayer,
	matchTarget,
} from "@hazel/shared-screens/channel-sidebar/ChannelSidebar"
import { appRequestsLayer } from "@hazel/shared-screens/app/requests"
import type { OrganizationId } from "@hazel/schema"
import { Deferred, Effect, Layer, Option, Stream } from "effect"
import { NativeSessionControls, PlatformJsc } from "../../../packages/client-data/src/platform/jsc/index.ts"
import { makeNativeHost } from "../../../packages/ui/src/native/host.ts"
import { type Json, WIRE_VERSION } from "../../../packages/ui/src/native/wire.ts"
import { authFlowsJsc } from "./auth"
import { appShell, serverLabel } from "./shell"

declare const __native: { post: (json: string) => void }

const native = makeNativeHost((batch) => __native.post(JSON.stringify(batch)))

/** The sign-in screen until a browser sign-in stores a session. */
const signIn = Effect.gen(function* () {
	const shell = appShell()
	const done = yield* Deferred.make<void>()
	yield* Renderer.mount(
		SignInPage,
		{
			mode: "SignIn",
			redirectUrl: null,
			initialError: null,
			switchHref: "",
			initialServer: {
				label: serverLabel(shell.server),
				isDefault: shell.server.isDefault,
				form: null,
			},
		},
		native.container,
	).pipe(Effect.provide(authFlowsJsc(shell.server, Deferred.succeed(done, undefined).pipe(Effect.asVoid))))
	yield* Deferred.await(done)
	console.log("[hazel] signed in")
}).pipe(Effect.scoped)

/** N0's root: the shared sidebar; a channel opens in the web fallback until N2 makes it native. */
const root = Effect.gen(function* () {
	const data = yield* ClientData
	const rpc = yield* HazelRpc
	const me = yield* rpc("user.me", undefined)
	yield* Stream.runDrain(data.syncSession(me.id)).pipe(Effect.forkScoped)
	const org = yield* data
		.liveQueryStream(
			(q) => q.from({ org: data.collections.organizationCollection }),
			(rows: ReadonlyArray<{ id: OrganizationId; slug: string | null }>) => rows[0],
		)
		.pipe(
			Stream.filter((row) => row !== undefined),
			Stream.runHead,
			Effect.map(Option.getOrThrow),
		)
	const slug = org.slug ?? ""
	const shell = appShell()
	yield* Renderer.mount(
		ChannelSidebar,
		{
			organizationId: org.id,
			userId: me.id,
			orgSlug: slug,
			activeChannelId: null,
			membersActive: false,
			hintDismissed: false,
			paletteKey: null,
			chrome: true,
		},
		native.container,
	).pipe(
		Effect.provide(
			Layer.mergeAll(
				channelSidebarLayer(
					data,
					(to) =>
						shell.openFallback(
							matchTarget(to, {
								Channel: (id) => `/${slug}/chat/${id}`,
								Members: () => `/${slug}/settings/team`,
							}),
						),
					(action) => Effect.sync(() => console.log(`[hazel] sidebar action ${action._tag}`)),
				),
				sidebarWritesLayer(data, rpc),
				appRequestsLayer((request) => console.log(`[hazel] request ${request._tag}`)),
			),
		),
	)
	console.log(`[hazel] root mounted for ${me.id}`)
	return yield* Effect.never
})

const program = Effect.gen(function* () {
	console.log(`[hazel] shims installed: ${shimmed.join(", ") || "none"}`)
	const controls = yield* NativeSessionControls
	if (!controls.hasCredential()) yield* signIn
	return yield* root
})

program.pipe(
	Effect.provide(
		Layer.mergeAll(
			Layer.mergeAll(ClientData.layer, HazelRpcLayer).pipe(Layer.provideMerge(PlatformJsc)),
			native.layer,
		),
	),
	Effect.scoped,
	Effect.tapCause((cause) => Effect.sync(() => console.error(`[hazel] failed: ${String(cause)}`))),
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
