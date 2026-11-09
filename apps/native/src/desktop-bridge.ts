/**
 * The three Tauri APIs the app's desktop sign-in uses (`web-foldkit/src/platform/desktop-auth.ts`),
 * answered by the native host: `core.invoke` for the keychain vault, `deepLink` for the callback
 * the system opens with the app, and `opener` for the system browser. Installed as
 * `window.__TAURI__` without `__TAURI_INTERNALS__`, so the app's other Tauri features stay off.
 */
import type { HostToRuntime, RuntimeToHost } from "@hazel/foldkit-rune"

type VaultRequest = Extract<RuntimeToHost, { t: "vault" }>
type VaultAnswer = Extract<HostToRuntime, { t: "vault" }>

/** Links kept before the sign-in listens: the one that launched the app, at most a few. */
const MAX_QUEUED_LINKS = 8

export const makeDesktopBridge = (options: {
	readonly send: (request: VaultRequest) => void
	/** Opens a web link in the system browser. */
	readonly openUrl: (url: string) => void
}) => {
	let nextId = 0
	const waiting = new Map<
		number,
		{ resolve: (record: string | null) => void; reject: (error: Error) => void }
	>()
	const vault = (request: { op: "read" } | { op: "write"; record: string }) =>
		new Promise<string | null>((resolve, reject) => {
			nextId += 1
			waiting.set(nextId, { resolve, reject })
			options.send({ t: "vault", id: nextId, ...request })
		})

	const queued: Array<string> = []
	const listeners = new Set<(urls: ReadonlyArray<string>) => void>()

	/** The vault's record for a read; a write resolves to `null` once the keychain has it. */
	const invoke = (command: string, args?: Record<string, unknown>): Promise<string | null> => {
		if (command === "auth_vault_read") return vault({ op: "read" })
		if (command === "auth_vault_write" && typeof args?.record === "string")
			return vault({ op: "write", record: args.record }).then(() => null)
		return Promise.reject(new Error(`the native app has no command ${command}`))
	}

	const tauri = {
		core: { invoke },
		deepLink: {
			onOpenUrl: (listener: (urls: ReadonlyArray<string>) => void) => {
				listeners.add(listener)
				return Promise.resolve(() => void listeners.delete(listener))
			},
			/** The links that arrived before anyone listened (a cold start from the callback). */
			getCurrent: () => Promise.resolve(queued.length === 0 ? null : queued.splice(0)),
		},
		opener: {
			openUrl: (url: string) => Promise.resolve(options.openUrl(url)),
		},
	}

	const answer = (message: VaultAnswer) => {
		const request = waiting.get(message.id)
		if (request === undefined) return
		waiting.delete(message.id)
		if (message.error !== undefined) request.reject(new Error(message.error))
		else request.resolve(message.record ?? null)
	}

	const openedUrl = (url: string) => {
		if (listeners.size === 0) {
			if (queued.length < MAX_QUEUED_LINKS) queued.push(url)
			return
		}
		for (const listener of listeners) listener([url])
	}

	return { tauri, answer, openedUrl }
}

/** A link for the log: scheme, host and path, and the query's names only (it carries the code). */
export const describeLink = (url: string) => {
	const parsed = URL.parse(url)
	if (parsed === null) return "(not a URL)"
	const names = [...parsed.searchParams.keys()]
	return `${parsed.protocol}//${parsed.host}${parsed.pathname}${names.length === 0 ? "" : ` ?${names.join("&")}`}`
}
