import { defineIntegration } from "../kit/define"
import { AutumnConnectionConfig, DEFAULT_AUTUMN_CONFIG } from "./config"
import { presentation } from "./presentation"

export const autumn = defineIntegration({
	id: "autumn",
	config: { schema: AutumnConnectionConfig, default: DEFAULT_AUTUMN_CONFIG },
	ingest: { linkHosts: ["useautumn.com"] },
	precedence: { name: 30, logoUrl: 30, seatsUsed: 10, seatsLimit: 10, email: 30 },
	capabilities: { billing: { preference: 10, requiresFirstImport: true }, meteredLimits: true },
	presentation,
	server: () => import("./server"),
})
