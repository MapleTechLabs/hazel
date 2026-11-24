import { Effect } from "effect"
import { buildServer, discoveryDocumentOf, type Server, storeServer } from "~/config/server"
import { signOut } from "../app/auth"
import type { HazelAuthClient } from "../auth/client"
import { KeychainStore } from "./desktop-auth"
import { getTauriCore, isTauri } from "./tauri"

/** A vault record with no session and no sign-in in progress (`@hazel/auth/desktop`). */
const EMPTY_VAULT_RECORD = JSON.stringify({ credentials: {} })

/**
 * Points the native app at another install (`null`: the build's own, Hazel cloud). The previous
 * install's session ends there (best effort: it may be unreachable) and the keychain record is
 * emptied either way, so no credential of one install is ever sent to another. Then the app starts
 * over on the new install: the desktop app keeps the choice in its own storage and reloads; the iOS
 * shell keeps it (`server_set`, `HostBridge.swift`) and loads the page again on that install's
 * origin, which the install's API allows (its `FRONTEND_URL`).
 */
export const switchServer = (next: Server | null): Effect.Effect<void, never, HazelAuthClient> =>
	Effect.gen(function* () {
		yield* signOut.pipe(Effect.ignore)
		yield* KeychainStore.write(EMPTY_VAULT_RECORD).pipe(Effect.ignore)
		const core = getTauriCore()
		if (!isTauri() && core !== undefined) {
			// The iOS shell answers the desktop host's APIs; it reloads the page itself.
			yield* Effect.tryPromise(() =>
				core.invoke("server_set", {
					server: next === null ? null : JSON.stringify(discoveryDocumentOf(next)),
				}),
			).pipe(Effect.ignore)
			return
		}
		yield* Effect.sync(() => {
			try {
				storeServer(localStorage, next, buildServer())
			} catch {
				// Storage refused: the app stays on its install.
			}
			window.location.replace("/")
		})
	})
