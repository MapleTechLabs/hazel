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
import { FallbackScreen } from "@hazel/shared-screens/phone/FallbackScreen"
import { PhoneShell, ShellIntent } from "@hazel/shared-screens/phone/PhoneShell"
import type { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Deferred, Effect, Layer, Option, Schedule, Stream } from "effect"
import type { HttpClient } from "effect/http"
import {
	NativeSessionControls,
	onSessionRejected,
	PlatformJsc,
} from "../../../packages/client-data/src/platform/jsc/index.ts"
import { makeNativeHost } from "../../../packages/ui/src/native/host.ts"
import { type Json, WIRE_VERSION } from "../../../packages/ui/src/native/wire.ts"
import { authFlowsJsc, signOutJsc } from "./auth"
import { installDemo } from "./demo"
import { makePhoneHost, navigation } from "./phone-host"
import { appShell, serverLabel } from "./shell"

declare const __native: { post: (json: string) => void }
/** Set by the demo bundle (`build:hazel:demo`): the offline fixture in-process (`./demo.ts`). */
declare const __HAZEL_DEMO__: boolean

// A constant at build time: the app's own bundle leaves the fixture out.
if (__HAZEL_DEMO__) installDemo()

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

interface Membership {
	readonly member: { readonly id: OrganizationMemberId; readonly organizationId: OrganizationId }
	readonly organization: { readonly slug: string | null }
}

/** The install's link-preview worker (Hazel's; another install's arrives with its discovery). */
const LINK_PREVIEW_URL = "https://link-preview.hazel.sh"

/** How long a signed-in account's organizations may take to sync before onboarding shows. */
const NO_ORGANIZATION_AFTER = "10 seconds"

/**
 * Ends the session (on the API, best effort, and in the keychain) and starts the script over, at
 * the sign-in screen.
 */
const signOutAndRestart = Effect.gen(function* () {
	const controls = yield* NativeSessionControls
	yield* signOutJsc(appShell().server).pipe(Effect.ignore)
	controls.signOut()
	appShell().restart()
})

/** The signed-in user, retried while offline; a session the API refuses signs out. */
const currentUser = (signOut: Effect.Effect<void>) =>
	Effect.flatMap(Effect.service(HazelRpc), (rpc) =>
		rpc("user.me", undefined).pipe(
			Effect.retry({
				schedule: Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("30 seconds")]),
				while: (error) => error._tag !== "UnauthorizedError",
			}),
			Effect.catchTag("UnauthorizedError", () => Effect.andThen(signOut, Effect.never)),
		),
	)

/** The user's first organization; onboarding (the web's) shows while there is none yet. */
const firstMembership = (userId: UserId) =>
	Effect.gen(function* () {
		const data = yield* ClientData
		const { organizationMemberCollection, organizationCollection } = data.collections
		const first = data
			.liveQueryStream<Membership, Membership | undefined>(
				(q) =>
					q
						.from({ member: organizationMemberCollection })
						.innerJoin({ organization: organizationCollection }, ({ member, organization }) =>
							eq(organization.id, member.organizationId),
						)
						.where(({ member }) => eq(member.userId, userId)),
				(rows) => rows[0],
			)
			.pipe(
				Stream.filter((row): row is Membership => row !== undefined),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
			)
		const early = yield* first.pipe(Effect.timeoutOption(NO_ORGANIZATION_AFTER))
		if (Option.isSome(early)) return early.value
		return yield* Effect.scoped(
			Effect.andThen(
				Renderer.mount(FallbackScreen, { path: "/onboarding", title: "" }, native.container),
				first,
			),
		)
	})

/** The phone shell for the user's first organization, on the phone's host services. */
const root = (signOut: Effect.Effect<void>) =>
	Effect.gen(function* () {
		const data = yield* ClientData
		const me = yield* currentUser(signOut)
		yield* Stream.runDrain(data.syncSession(me.id)).pipe(Effect.forkScoped)
		const membership = yield* firstMembership(me.id)
		const host = yield* makePhoneHost({ me, organizationId: membership.member.organizationId }, signOut)
		// The unread channels sync in the background, so opening one finds its messages in.
		yield* Effect.forkScoped(host.prefetch)
		yield* Renderer.mount(
			PhoneShell,
			{
				cdnUrl: appShell().server.cdn ?? "",
				linkPreviewUrl: LINK_PREVIEW_URL,
				appOrigin: appShell().server.app,
			},
			native.container,
		).pipe(Effect.provide(host.layer))
		console.log(`[hazel] root mounted for ${me.id}`)
		return yield* Effect.never
	})

const program = Effect.gen(function* () {
	console.log(`[hazel] shims installed: ${shimmed.join(", ") || "none"}`)
	const controls = yield* NativeSessionControls
	if (!controls.hasCredential()) yield* signIn
	const signOut = signOutAndRestart.pipe(
		Effect.provide(yield* Effect.context<NativeSessionControls | HttpClient.HttpClient>()),
	)
	// The API refused the session (a 401 on the sync token): back to sign-in.
	onSessionRejected(() => Effect.runFork(signOut))
	return yield* root(signOut)
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
		// Swift's inbound messages: events, and the replies to `Hazel.Host` commands (focus, scrollTo).
		receive: native.receive,
		receiveMany: native.receiveMany,
		fire: (id: number, event: string, payload: string) =>
			// SAFETY: the shell sends `payload` as JSON.stringify of a plain object (`TreeHost`).
			native.fire(id, event, JSON.parse(payload) as Json),
		/** An in-app path from the host: a tapped link, a push, a deep link. */
		openPath: (path: string) => {
			console.log(`[hazel] open ${path}`)
			navigation.intend(ShellIntent.Open({ href: path }))
		},
	},
})
