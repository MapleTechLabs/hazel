import type { ActivityDemo } from "../kit/demo"
import { DEFAULT_MAPLE_CONFIG, type MapleConnectionConfig } from "./config"

const SAMPLE_CONFIG: MapleConnectionConfig = {
	...DEFAULT_MAPLE_CONFIG,
	activityEvents: [
		"query_run",
		"dashboard_viewed",
		"trace_explored",
		"dashboard_created",
		"alert_rule_created",
		"api_key_created",
	],
	metricMappings: [
		{ event: "dashboard_created", metricKey: "dashboards_created" },
		{ event: "alert_rule_created", metricKey: "alert_rules_created" },
		{ event: "query_run", metricKey: "queries_run" },
	],
}

export const demo: ActivityDemo = {
	role: "activity",
	accountUrl: (externalId) => `https://app.maple.dev/groups/${externalId}`,
	sampleConfig: SAMPLE_CONFIG,
}
