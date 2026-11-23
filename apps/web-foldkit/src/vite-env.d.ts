/// <reference types="vite/client" />
declare const __APP_VERSION__: string
interface ImportMetaEnv {
	readonly VITE_BACKEND_URL: string
	/** Where the web app lives; the desktop app opens its `/auth/desktop` page to sign in. */
	readonly VITE_APP_URL?: string
	/** The link-preview worker that unfurls URLs (`chat/unfurl.ts`). */
	readonly VITE_LINK_PREVIEW_URL?: string
	/** Public base URL of uploads (the R2 bucket's domain). */
	readonly VITE_R2_PUBLIC_URL?: string
}
