/**
 * Push notifications in the iOS shell (`HazelHybrid/PushNotifications.swift`):
 *
 * - Registration: while a user is signed in, the page asks the shell for this device's APNs token
 *   (`push_register`, which also asks for permission and keeps the API's address and the user's id
 *   for the push's actions) and registers it with the API (`pushDevice.register`). It tries at
 *   start and, while signed out, every few seconds (a check of the vault, no request), so a sign-in
 *   registers soon after; a refusal (permission denied, no token) is tried again only when the app
 *   comes back to the front.
 * - Sign-out forgets the token on the API first (`web-foldkit/src/platform/push-device.ts`), then
 *   tells the shell (`push_forget`), whose actions then have no one to act as.
 * - A tapped push opens its path (`__hazelOpenPath`).
 */
import { PUSH_DEVICE_GLOBAL, type PushDevice } from "../../web-foldkit/src/platform/push-device"
import { openAppPath } from "../../web-foldkit/src/platform/app-path"

/** The shell's answer to `push_register`. */
export type PushToken = {
	readonly token: string
	readonly bundleId: string
	readonly environment: "development" | "production"
}

export type PushHost = {
	/** The token, once allowed; rejects when it is not (denied, no APNs). */
	readonly register: (account: { readonly api: string; readonly userId: string }) => Promise<PushToken>
	readonly forget: () => Promise<void>
}

export type PushApi = {
	/** The signed-in user's id and the API's base URL, or `null` when signed out. */
	readonly account: () => Promise<{ readonly api: string; readonly userId: string } | null>
	readonly register: (token: PushToken) => Promise<void>
	readonly unregister: (token: string) => Promise<void>
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The registration's state machine, over the shell and the API (tests answer both). */
export const makePushRegistration = (options: {
	readonly host: PushHost
	readonly api: PushApi
	readonly log: (line: string) => void
}) => {
	const { host, api, log } = options
	/** The token the API has for this user, from this page. */
	let registered: string | undefined
	/** The token the shell handed last: what sign-out forgets. */
	let latest: string | undefined
	let inFlight: Promise<void> | undefined
	/** The shell gave no token (permission denied, no APNs): only a return to the front tries again. */
	let refused = false
	/** Sign-out is forgetting the device: nothing registers it again until that is done. */
	let signingOut = false

	const attempt = async () => {
		if (registered !== undefined || signingOut) return
		const account = await api.account()
		if (account === null) return
		let token: PushToken
		try {
			token = await host.register(account)
		} catch (error) {
			refused = true
			log(`[push] no token: ${describe(error)}`)
			return
		}
		latest = token.token
		await api.register(token)
		registered = token.token
		log(`[push] registered ${token.token.slice(0, 8)}… (${token.environment})`)
	}

	/** Registers if signed in and not yet registered; one attempt at a time, never rejects. */
	const ensure = (): Promise<void> => {
		if (signingOut) return Promise.resolve()
		refused = false
		inFlight ??= attempt()
			.catch((error: unknown) => log(`[push] register failed: ${describe(error)}`))
			.finally(() => {
				inFlight = undefined
			})
		return inFlight
	}

	/** Sign-out: the API forgets the token (while the session can still say whose), then the shell. */
	const unregister = async (): Promise<void> => {
		signingOut = true
		try {
			// An attempt already running may still register: let it land, so its token is forgotten too.
			await inFlight
			const token = latest
			registered = undefined
			latest = undefined
			try {
				if (token !== undefined) await api.unregister(token)
			} catch (error) {
				log(`[push] unregister failed: ${describe(error)}`)
			}
			await host.forget().catch(() => undefined)
		} finally {
			signingOut = false
		}
	}

	/** The periodic retry: not once registered, nor after the shell refused, nor during sign-out. */
	const retry = (): Promise<void> =>
		registered !== undefined || refused || signingOut ? Promise.resolve() : ensure()

	return { ensure, retry, unregister, isRegistered: () => registered !== undefined }
}

type HostMessage = {
	postMessage: (body: {
		command: string
		args: Record<string, unknown>
	}) => Promise<{ value?: unknown; error?: string }>
}

const hostHandler = (): HostMessage | undefined =>
	(window as { webkit?: { messageHandlers?: { host?: HostMessage } } }).webkit?.messageHandlers?.host

const askHost = async (command: string, args: Record<string, unknown>) => {
	const host = hostHandler()
	if (host === undefined) throw new Error("no host")
	const answer = await host.postMessage({ command, args })
	if (answer.error !== undefined) throw new Error(answer.error)
	return answer.value
}

/** The web app's RPC client, for one call with the session; `null` when signed out. */
const withRpc = async <A>(
	use: (
		client: import("../../web-foldkit/src/rpc").HazelRpc["Service"],
	) => import("effect").Effect.Effect<A, unknown>,
): Promise<A | null> => {
	const { Effect } = await import("effect")
	const { sessionAuthorizationEffect } = await import("../../web-foldkit/src/core/lib/session-bearer")
	const { HazelRpc, HazelRpcLive } = await import("../../web-foldkit/src/rpc")
	const program = Effect.gen(function* () {
		if ((yield* sessionAuthorizationEffect) === null) return null
		const client = yield* HazelRpc
		return yield* use(client)
	}).pipe(Effect.provide(HazelRpcLive))
	return Effect.runPromise(program as import("effect").Effect.Effect<A | null>)
}

/** One RPC with the session: the call's result, or `null` when signed out. */
export type WithRpc = <A>(
	use: (
		client: import("../../web-foldkit/src/rpc").HazelRpc["Service"],
	) => import("effect").Effect.Effect<A, unknown>,
) => Promise<A | null>

export const makeLiveApi = (rpc: WithRpc, apiUrl: () => Promise<string>): PushApi => ({
	account: async () => {
		const user = await rpc((client) => client("user.me", undefined))
		return user === null ? null : { api: await apiUrl(), userId: user.id }
	},
	register: async (token) => {
		// No session (signed out meanwhile): nothing was registered, so it is tried again later.
		const sent = await rpc((client) => client("pushDevice.register", token))
		if (sent === null) throw new Error("signed out")
	},
	unregister: async (token) => {
		await rpc((client) => client("pushDevice.unregister", { token }))
	},
})

const liveApi = makeLiveApi(withRpc, async () => {
	const { apiUrl } = await import("../../web-foldkit/src/core/config/server")
	return apiUrl()
})

const liveHost: PushHost = {
	register: async (account) => (await askHost("push_register", account)) as PushToken,
	forget: async () => {
		await askHost("push_forget", {})
	},
}

/** How often a page not yet registered tries again. */
const RETRY_MS = 15_000

export const installPush = () => {
	Object.assign(window, { __hazelOpenPath: openAppPath })
	const registration = makePushRegistration({
		host: liveHost,
		api: liveApi,
		log: (line) => console.info(line),
	})
	const device: PushDevice = { unregister: registration.unregister }
	Object.assign(globalThis, { [PUSH_DEVICE_GLOBAL]: device })
	const timer = setInterval(() => void registration.retry(), RETRY_MS)
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") void registration.ensure()
	})
	void registration.ensure()
	return () => clearInterval(timer)
}
