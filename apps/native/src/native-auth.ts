/**
 * How the native app signs in. Live data without a pasted `HAZEL_SESSION_TOKEN` signs in through
 * the system browser as the `native` client and keeps the session in the macOS keychain, as the
 * Tauri app does; offline and token runs never touch the keychain.
 */
import { type BrowserLoginClient, nativeClient } from "@hazel/auth/contract"
import { readConfig } from "./config"

/** Replaces `platform/desktop.ts`'s own (overlay-plugin.ts): the app signs in as this client. */
export const desktopAuthClient: BrowserLoginClient | null = readConfig(process.env).keychainSession
	? nativeClient
	: null
