// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The native app's script (`Hazel/AppRuntime.swift`, `docs/ios-native.md`): the shared `hazel`
 * screens in JavaScriptCore, drawn by HazelUI. Signs in first when the keychain holds no session,
 * then mounts the root. A route with no native screen yet opens in the shell's web fallback.
 */
import { shimmed } from "../effect-ui/live-globals"
import { Renderer, UiSchema } from "@effect/ui"
import { ClientData, HazelRpc, HazelRpcLayer } from "@hazel/client-data"
import { SignInPage } from "@hazel/shared-screens/auth/pages/sign-in/SignInPage"
import { activityLayer } from "@hazel/shared-screens/activity/Activity"
import { appRequestsLayer } from "@hazel/shared-screens/app/requests"
import { AppRoute, hrefOf } from "@hazel/shared-screens/app/route"
import { sidebarWritesLayer } from "@hazel/shared-screens/channel-sidebar/actions"
import { channelSidebarLayer, matchTarget } from "@hazel/shared-screens/channel-sidebar/ChannelSidebar"
import { dmsLayer } from "@hazel/shared-screens/dms/Dms"
import { PhoneShell, ShellIntent, ShellIntents, WebFallback } from "@hazel/shared-screens/phone/PhoneShell"
import { Hazel } from "../../../packages/ui/src/vocabulary/index.ts"
import type { ChannelId, OrganizationId, OrganizationMemberId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Deferred, Effect, Layer, Match, Option, Queue, Schedule, Schema, Stream } from "effect"
import type { HttpClient } from "effect/http"
import {
	NativeSessionControls,
	onSessionRejected,
	PlatformJsc,
} from "../../../packages/client-data/src/platform/jsc/index.ts"
import { makeNativeHost } from "../../../packages/ui/src/native/host.ts"
import { type Json, WIRE_VERSION } from "../../../packages/ui/src/native/wire.ts"
import { authFlowsJsc, signOutJsc } from "./auth"
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

interface Membership {
	readonly member: { readonly id: OrganizationMemberId; readonly organizationId: OrganizationId }
	readonly organization: { readonly slug: string | null }
}

/** Every navigation the screens, the app's requests and the host ask for (`ShellIntents`). */
const intents = Effect.runSync(Queue.unbounded<ShellIntent>())
const intend = (intent: ShellIntent) => void Queue.offerUnsafe(intents, intent)

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

const PhoneScreen = Hazel.component({
	name: "Onboarding",
	props: Schema.Struct({}),
	model: Schema.Struct({}),
	message: UiSchema.TaggedEnum({ Noop: {} }),
})

/** A new account's onboarding: the web's, until it is a shared screen. */
const Onboarding = PhoneScreen.make({
	init: () => ({}),
	update: { Noop: ($) => $.model },
	view: (h) => h.screen.surface("page").children(h.extension(WebFallback, { path: "/onboarding" })),
})

/** The phone shell (`PhoneShell`): tabs over a native stack each, for the first organization. */
const root = (signOut: Effect.Effect<void>) =>
	Effect.gen(function* () {
		const data = yield* ClientData
		const rpc = yield* HazelRpc
		// A session the API refuses is signed out here too, so the next start signs in.
		// Offline or a failing API at launch: tried again, backing off to every 30 seconds.
		const me = yield* rpc("user.me", undefined).pipe(
			Effect.retry({
				schedule: Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("30 seconds")]),
				while: (error) => error._tag !== "UnauthorizedError",
			}),
			Effect.catchTag("UnauthorizedError", () => Effect.andThen(signOut, Effect.never)),
		)
		yield* Stream.runDrain(data.syncSession(me.id)).pipe(Effect.forkScoped)
		const { organizationMemberCollection, organizationCollection } = data.collections
		const firstMembership = data
			.liveQueryStream<Membership, Membership | undefined>(
				(q) =>
					q
						.from({ member: organizationMemberCollection })
						.innerJoin({ organization: organizationCollection }, ({ member, organization }) =>
							eq(organization.id, member.organizationId),
						)
						.where(({ member }) => eq(member.userId, me.id)),
				(rows) => rows[0],
			)
			.pipe(
				Stream.filter((row): row is Membership => row !== undefined),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
			)
		const early = yield* firstMembership.pipe(Effect.timeoutOption(NO_ORGANIZATION_AFTER))
		// None yet (a new account, or a slow sync): onboarding shows until one syncs, then the shell.
		const membership = Option.isSome(early)
			? early.value
			: yield* Effect.scoped(
					Effect.andThen(Renderer.mount(Onboarding, {}, native.container), firstMembership),
				)
		const slug = membership.organization.slug ?? ""
		const openChannel = (id: ChannelId) =>
			intend(ShellIntent.Open({ href: hrefOf(AppRoute.ChatChannel({ orgSlug: slug, channelId: id })) }))
		yield* Renderer.mount(
			PhoneShell,
			{
				organizationId: membership.member.organizationId,
				memberId: membership.member.id,
				userId: me.id,
				orgSlug: slug,
				nowMs: Date.now(),
			},
			native.container,
		).pipe(
			Effect.provide(
				Layer.mergeAll(
					Layer.succeed(ShellIntents, { intents: Stream.fromQueue(intents) }),
					channelSidebarLayer(
						data,
						(to) =>
							matchTarget(to, {
								Channel: openChannel,
								Members: () =>
									intend(
										ShellIntent.Open({
											href: hrefOf(AppRoute.TeamSettings({ orgSlug: slug })),
										}),
									),
							}),
						(action) =>
							Match.valueTags(action, {
								AccountMenu: ({ key }) =>
									key === "sign-out"
										? signOut
										: Effect.sync(() => console.log(`[hazel] account menu ${key}`)),
								// The org switcher and the hint arrive with the More tab (N3).
								OrgMenu: ({ key }) =>
									Effect.sync(() => console.log(`[hazel] org menu ${key}`)),
								DismissHint: () => Effect.void,
							}),
					),
					sidebarWritesLayer(data, rpc),
					dmsLayer(data, openChannel, () => console.log("[hazel] compose")),
					activityLayer(data, rpc, openChannel),
					appRequestsLayer((request) =>
						Match.valueTags(request, {
							Navigate: ({ href }) => intend(ShellIntent.Open({ href })),
							History: ({ direction }) => {
								if (direction === "Back") intend(ShellIntent.Back())
							},
							// The rest arrive with the screens that need them (N2, N3).
							LoadPage: () => console.log("[hazel] request LoadPage"),
							ShowToast: () => console.log("[hazel] request ShowToast"),
							OpenModal: () => console.log("[hazel] request OpenModal"),
							OpenCommandPalette: () => console.log("[hazel] request OpenCommandPalette"),
							SignOut: () => void Effect.runFork(signOut),
							CreateDm: () => console.log("[hazel] request CreateDm"),
							SetTheme: () => console.log("[hazel] request SetTheme"),
							SetSoundSettings: () => console.log("[hazel] request SetSoundSettings"),
							SetKeybindings: () => console.log("[hazel] request SetKeybindings"),
							RefreshCurrentUser: () => console.log("[hazel] request RefreshCurrentUser"),
							CheckForUpdate: () => console.log("[hazel] request CheckForUpdate"),
							InstallUpdate: () => console.log("[hazel] request InstallUpdate"),
						}),
					),
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
		fire: (id: number, event: string, payload: string) =>
			// SAFETY: the shell sends `payload` as JSON.stringify of a plain object (`TreeHost`).
			native.fire(id, event, JSON.parse(payload) as Json),
		/** An in-app path from the host: a tapped link, a push, a deep link. */
		openPath: (path: string) => {
			console.log(`[hazel] open ${path}`)
			intend(ShellIntent.Open({ href: path }))
		},
	},
})
