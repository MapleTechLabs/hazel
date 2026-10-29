/// <reference types="vite/client" />
declare const __APP_VERSION__: string
interface ImportMetaEnv {
	readonly VITE_BACKEND_URL: string
	/** Where the web app lives; the desktop app opens its `/auth/desktop` page to sign in. */
	readonly VITE_APP_URL?: string
}
