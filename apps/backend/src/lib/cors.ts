/**
 * The api's CORS policy, in one place: the router applies it to every route (`app.ts`), and the
 * Worker answers a preflight from it before the route graph exists (`worker/http.ts`).
 */
import { Config, Effect, Option } from "effect"

export const corsPolicy = Effect.map(Config.option(Config.String("FRONTEND_URL")), (frontendUrl) => ({
	allowedOrigins: [
		...new Set([
			"http://localhost:3000",
			"http://localhost:3100",
			"http://localhost:5173",
			"https://app.hazel.sh",
			"tauri://localhost",
			"http://tauri.localhost",
			// The stage's own web app (`https://app-pr-<n>.hazel.sh` on a preview).
			...Option.toArray(Option.map(frontendUrl, (url) => new URL(url).origin)),
		]),
	],
	allowedMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
	credentials: true,
	// Without it a preflight is cached for 5s (Chrome), so each load's first session check,
	// token exchange and RPC waited a round trip on `OPTIONS`. Chrome caps this at 2h.
	maxAge: 7200,
}))
