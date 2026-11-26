/**
 * The `__native` bridge a JavaScriptCore host installs before the package loads
 * (`apps/ios-hybrid/HazelUI/Sources/HazelUI/Runtime/NativePlatform.swift`). Calls are synchronous
 * into Swift; Swift answers asynchronous work through the callbacks given here, on the JS thread,
 * with the callbacks that are due in one turn coalesced into one.
 *
 * Bytes cross as `Uint8Array` / `ArrayBuffer`, never base64: Swift reads and makes typed arrays with
 * JavaScriptCore's C API. The members marked G3 are what the spike's `HazelPlatform.swift` still
 * installs; the services fall back to them while it does.
 */

/** One socket event; a binary frame arrives as an `ArrayBuffer`. */
export type NativeSocketEvent =
	| { readonly type: "open"; readonly protocol: string }
	| { readonly type: "message"; readonly data: string | ArrayBuffer }
	| { readonly type: "close"; readonly code: number; readonly reason: string }
	| { readonly type: "error"; readonly message: string }

/** A streamed HTTP exchange: one `head`, any number of `chunk`s, then `end` or `error`. */
export type NativeHttpEvent =
	| {
			readonly type: "head"
			readonly status: number
			readonly url: string
			readonly headers: Readonly<Record<string, string>>
	  }
	| { readonly type: "chunk"; readonly data: Uint8Array }
	| { readonly type: "end" }
	| { readonly type: "error"; readonly message: string }

/** G3's finished HTTP exchange, the body in base64. */
export interface NativeHttpResult {
	readonly status: number
	readonly url: string
	readonly headers: Readonly<Record<string, string>>
	readonly bodyBase64: string
}

/** A file the host holds (picked or dropped), by handle: its bytes stay in Swift. */
export interface NativeFile {
	readonly handle: string
	readonly name: string
	/** Bytes. */
	readonly size: number
	/** Its MIME type, `""` when unknown. */
	readonly type: string
	readonly kind: "image" | "video" | "file"
	readonly width?: number
	readonly height?: number
}

/** A SQLite value: `Uint8Array` is a BLOB. Rows come back as JSON (BLOBs as base64 strings). */
export type NativeSqlValue = string | number | boolean | null | Uint8Array

export interface NativeBridge {
	readonly uuid: () => string
	/** `count` bytes from the system's secure random (`crypto.getRandomValues`, `./runtime-shims.ts`). */
	readonly randomBytes?: (count: number) => Uint8Array
	readonly kv: {
		readonly get: (key: string) => string | null | undefined
		readonly set: (key: string, value: string) => void
		readonly remove: (key: string) => void
	}
	readonly socket: {
		/** Opens a socket; returns its id. */
		readonly open: (
			url: string,
			protocols: Array<string>,
			onEvent: (event: NativeSocketEvent) => void,
		) => number
		/** A string is a text frame, bytes a binary frame (G3 sends text only). */
		readonly send: (id: number, data: string | Uint8Array) => void
		readonly close: (id: number, code: number, reason: string) => void
		/** Present on a host that takes binary frames. */
		readonly binary?: true
	}
	readonly http: {
		/** Starts a streamed request; returns its id. The body is bytes or none. */
		readonly start?: (
			method: string,
			url: string,
			headers: Record<string, string>,
			body: Uint8Array | null,
			onEvent: (event: NativeHttpEvent) => void,
		) => number
		/** G3: the whole exchange at once, bodies in base64. */
		readonly request?: (
			method: string,
			url: string,
			headers: Record<string, string>,
			bodyBase64: string | null,
			done: (result: NativeHttpResult | null, error: string | null) => void,
		) => number
		/** Stops a request; no event follows. */
		readonly cancel: (id: number) => void
	}
	readonly connectivity: {
		/** Calls `listener` each time the network becomes reachable again; returns an id for `off`. */
		readonly onOnline: (listener: () => void) => number
		readonly off: (id: number) => void
	}
	/** The keychain's one session record (`@hazel/auth/desktop`'s vault JSON), as the hybrid keeps it. */
	readonly session?: {
		readonly read: () => string | null | undefined
		/** Whether the keychain took it. */
		readonly write: (record: string) => boolean
		readonly clear: () => void
		/** The API refused the session (a 401 on the token exchange): the shell decides what follows. */
		readonly rejected: () => void
	}
	/** SQLite files in the app's support directory; every call runs on a serial queue per file. */
	readonly sqlite?: {
		readonly open: (name: string, done: (handle: number | null, error: string | null) => void) => void
		readonly execute: (
			handle: number,
			sql: string,
			params: Array<NativeSqlValue>,
			done: (rowsJson: string | null, error: string | null) => void,
		) => void
		readonly close: (handle: number, done: () => void) => void
		/** Deletes the file and its `-wal`, `-shm` and `-journal` side files. */
		readonly remove: (name: string, done: (error: string | null) => void) => void
	}
	readonly files?: {
		/** The system picker; a cancelled pick answers an empty list. Errors: `denied`. */
		readonly pick: (
			accept: "any" | "media",
			multiple: boolean,
			done: (files: Array<NativeFile> | null, error: string | null) => void,
		) => void
		/** Takes the files of the composer's last drop or paste (the host holds them until then). */
		readonly takeDropped: () => Array<NativeFile>
		/** PUTs the file's bytes to `url` from disk; returns an id for `cancel`. */
		readonly upload: (
			handle: string,
			url: string,
			contentType: string,
			done: (status: number, error: string | null) => void,
		) => number
		readonly cancel: (id: number) => void
		/** Lets go of the file (its temporary copy is deleted). */
		readonly release: (handle: string) => void
	}
	readonly clipboard?: {
		/** Whether the pasteboard took it. */
		readonly write: (text: string) => boolean
	}
	/**
	 * The server this build talks to. `token` is a stand-in session for a local fixture server
	 * only (the shell sends `null` for any other), used while the keychain holds no session.
	 */
	readonly config: { readonly apiUrl: string; readonly token: string | null }
}

declare const __native: NativeBridge | undefined

/** The host's bridge; throws when the context has none (a host that forgot to install it). */
export const nativeBridge = (): NativeBridge => {
	if (typeof __native === "undefined" || __native.socket === undefined)
		throw new Error("@hazel/client-data/jsc: the host installed no __native platform bridge")
	return __native
}
