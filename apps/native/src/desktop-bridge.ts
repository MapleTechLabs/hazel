/**
 * The Tauri APIs the app's desktop sign-in uses (`web-foldkit/src/platform/desktop-auth.ts`),
 * answered by the native host: `core.invoke` for the keychain vault, `deepLink` for the callback
 * the system opens with the app, and `opener` for the system browser. A release bundle also gets
 * the two its updates use (`web-foldkit/src/platform/updates.ts`): `updater` (check, download,
 * install, done by the host on its own bundle), `process.relaunch` and `app.getVersion`; and a
 * bundle the system knows by its identifier gets `notification` (system notifications). Installed as
 * `window.__TAURI__` without `__TAURI_INTERNALS__`, so the app's other Tauri features stay off.
 */
import type { HostToRuntime, RuntimeToHost } from "@hazel/foldkit-rune"

type VaultRequest = Extract<RuntimeToHost, { t: "vault" }>
type VaultAnswer = Extract<HostToRuntime, { t: "vault" }>
type UpdateRequest = Extract<RuntimeToHost, { t: "update" }>
type UpdateAnswer = Extract<HostToRuntime, { t: "update" }>
type UpdateProgress = Extract<HostToRuntime, { t: "updateProgress" }>
type PermissionAnswer = Extract<HostToRuntime, { t: "notifyPermission" }>
type Answer = VaultAnswer | UpdateAnswer | PermissionAnswer
type HostRequest =
	| VaultRequest
	| UpdateRequest
	| Extract<RuntimeToHost, { t: "relaunch" | "notifyPermission" | "notify" }>

/** The download events Tauri's `Update.download` reports, as `updates.ts` reads them. */
export type DownloadEvent =
	| { readonly event: "Started"; readonly data: { readonly contentLength?: number } }
	| { readonly event: "Progress"; readonly data: { readonly chunkLength: number } }
	| { readonly event: "Finished" }

/** Links kept before the sign-in listens: the one that launched the app, at most a few. */
const MAX_QUEUED_LINKS = 8

export const makeDesktopBridge = (options: {
	readonly send: (request: HostRequest) => void
	/** Opens a web link in the system browser. */
	readonly openUrl: (url: string) => void
	/** The host can update this app (a release bundle): offer `updater` and `process`. */
	readonly updates?: boolean
	/** This build's version, from the host (`app.getVersion`, shown in Settings > Desktop). */
	readonly version?: string
	/** The host can show system notifications: offer `notification`. */
	readonly notifications?: boolean
}) => {
	let nextId = 0
	const waiting = new Map<number, { resolve: (answer: Answer) => void; reject: (error: Error) => void }>()
	/** Sends a request with a fresh id; the host's answer with that id settles it. */
	const request = <A extends Answer>(make: (id: number) => HostRequest) =>
		new Promise<A>((resolve, reject) => {
			nextId += 1
			waiting.set(nextId, { resolve: (answer) => resolve(answer as A), reject })
			options.send(make(nextId))
		})
	const vault = (body: { op: "read" } | { op: "write"; record: string }) =>
		request<VaultAnswer>((id) => ({ t: "vault", id, ...body })).then((answer) => answer.record ?? null)

	const progressListeners = new Map<number, (message: UpdateProgress) => void>()
	const update = (op: UpdateRequest["op"]) => request<UpdateAnswer>((id) => ({ t: "update", id, op }))
	/** Downloads the update `check` found, reporting progress as Tauri's events. */
	const download = (onEvent?: (event: DownloadEvent) => void) => {
		let started = false
		let reported = 0
		return request<UpdateAnswer>((id) => {
			progressListeners.set(id, ({ downloaded, total }) => {
				if (!started) {
					started = true
					onEvent?.({ event: "Started", data: total == null ? {} : { contentLength: total } })
				}
				if (downloaded > reported) {
					onEvent?.({ event: "Progress", data: { chunkLength: downloaded - reported } })
					reported = downloaded
				}
			})
			return { t: "update", id, op: "download" }
		}).then(() => onEvent?.({ event: "Finished" }))
	}
	const updater = {
		/** The newer release, as Tauri's `Update` (what `updates.ts` reads of it), or `null`. */
		check: () =>
			update("check").then((answer) =>
				answer.version === undefined
					? null
					: {
							version: answer.version,
							body: answer.notes ?? undefined,
							download,
							install: () => update("install").then(() => undefined),
						},
			),
	}
	const appProcess = {
		/**
		 * The host quits and opens the app again, so this runtime ends with it and the promise
		 * never settles; it rejects when the host could not relaunch, so the app says so.
		 */
		relaunch: () => request<UpdateAnswer>((id) => ({ t: "relaunch", id })).then(() => undefined),
		exit: () => Promise.reject(new Error("the native app quits through relaunch")),
	}

	/** What `native-notifications.ts` reads of Tauri's notification plugin. */
	const permission = (ask: boolean) =>
		request<PermissionAnswer>((id) => ({ t: "notifyPermission", id, request: ask })).then(
			(answer) => answer.granted,
		)
	const notification = {
		isPermissionGranted: () => permission(false),
		requestPermission: () =>
			permission(true).then((granted): NotificationPermission => (granted ? "granted" : "denied")),
		sendNotification: (content: { title: string; body?: string; group?: string }) =>
			options.send({
				t: "notify",
				title: content.title,
				body: content.body ?? "",
				...(content.group === undefined ? {} : { group: content.group }),
			}),
	}

	const queued: Array<string> = []
	const listeners = new Set<(urls: ReadonlyArray<string>) => void>()

	/** The vault's record for a read; a write resolves to `null` once the keychain has it. */
	const invoke = (command: string, args?: Record<string, unknown>): Promise<string | null> => {
		if (command === "auth_vault_read") return vault({ op: "read" })
		if (command === "auth_vault_write" && typeof args?.record === "string")
			return vault({ op: "write", record: args.record }).then(() => null)
		return Promise.reject(new Error(`the native app has no command ${command}`))
	}

	const deepLink = {
		onOpenUrl: (listener: (urls: ReadonlyArray<string>) => void) => {
			listeners.add(listener)
			return Promise.resolve(() => void listeners.delete(listener))
		},
		/** The links that arrived before anyone listened (a cold start from the callback). */
		getCurrent: () => Promise.resolve(queued.length === 0 ? null : queued.splice(0)),
	}
	const opener = {
		openUrl: (url: string) => Promise.resolve(options.openUrl(url)),
	}
	// `updater` and `process` only for a bundle the host can update; elsewhere the app sees none.
	const tauri = {
		core: { invoke },
		deepLink,
		opener,
		updater: options.updates ? updater : undefined,
		process: options.updates ? appProcess : undefined,
		notification: options.notifications ? notification : undefined,
		app:
			options.version === undefined
				? undefined
				: { getVersion: () => Promise.resolve(options.version) },
	}

	/** The host's answer to a vault or update request, or a download's progress. */
	const answer = (message: Answer | UpdateProgress) => {
		if (message.t === "updateProgress") {
			progressListeners.get(message.id)?.(message)
			return
		}
		progressListeners.delete(message.id)
		const pending = waiting.get(message.id)
		if (pending === undefined) return
		waiting.delete(message.id)
		if ("error" in message && message.error !== undefined) pending.reject(new Error(message.error))
		else pending.resolve(message)
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
