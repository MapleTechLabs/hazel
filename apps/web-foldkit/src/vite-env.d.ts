/// <reference types="vite/client" />
declare const __APP_VERSION__: string
interface ImportMetaEnv {
	readonly VITE_BACKEND_URL: string
	readonly VITE_ELECTRIC_URL: string
}
