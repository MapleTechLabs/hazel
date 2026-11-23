import { defineIntegration } from "../kit/define"
import { DEFAULT_MAPLE_CONFIG, MapleConnectionConfig, regionOfAccountId } from "./config"
import { demo } from "./demo"
import { presentation } from "./presentation"
import { configProblem } from "./query"

export const maple = defineIntegration({
	id: "maple",
	config: {
		schema: MapleConnectionConfig,
		default: DEFAULT_MAPLE_CONFIG,
		problem: configProblem,
		// Without a new key nothing is validated: the region must stay the one the stored key was
		// checked against.
		changeProblem: (config, stored) =>
			config.region === regionOfAccountId(stored.externalAccountId)
				? null
				: "The stored key was checked against another Maple region: enter a key with the change",
	},
	ingest: { linkHosts: ["maple.dev"] },
	precedence: { name: 40, email: 40, avatarUrl: 20 },
	capabilities: { activity: true },
	presentation,
	demo,
	server: () => import("./server"),
})
