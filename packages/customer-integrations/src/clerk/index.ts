import { defineIntegration } from "../kit/define"
import { ClerkConnectionConfig, DEFAULT_CLERK_CONFIG } from "./config"
import { demo } from "./demo"
import { presentation } from "./presentation"

export const clerk = defineIntegration({
	id: "clerk",
	config: { schema: ClerkConnectionConfig, default: DEFAULT_CLERK_CONFIG },
	ingest: {
		linkHosts: ["clerk.com"],
		policy: (config) => ({ matchByDomain: true, createAccounts: config.createAccounts }),
	},
	precedence: { name: 10, logoUrl: 10, seatsUsed: 20, seatsLimit: 20, email: 10, avatarUrl: 10, role: 10 },
	capabilities: { activity: true, featureFlags: true, impersonation: true },
	presentation,
	demo,
	server: () => import("./server"),
})
