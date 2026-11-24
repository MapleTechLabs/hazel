import type { PresentationOf } from "../kit/presentation"
import type { MapleConnectionConfig } from "./config"

export const presentation: PresentationOf<MapleConnectionConfig> = {
	name: "Maple",
	accountNoun: "group",
	domain: "maple.dev",
	linkHosts: ["*.maple.dev"],
	blurb: "Product events by GroupId and UserId. Drives active users, usage trends and per-account metrics.",
	setupSummary: "Product usage and active users.",
	provides: ["Usage", "Activity"],
	adds: [
		{ title: "Activity", detail: "product events per user per day" },
		{ title: "Usage metrics", detail: "event counts per account per day" },
		{ title: "Usage signals", detail: "usage dropped, champion went quiet" },
	],
	accessNote:
		"Read-only. Hazel runs one counting query per day of product events and never writes to Maple.",
	isAvailable: true,
	apiKey: {
		label: "API key",
		placeholder: "maple_ak_…",
		createHref: "https://app.maple.dev/settings?tab=mcp",
		help: "Maple → Settings → MCP creates the narrowest key that works (it opens the MCP tools and nothing else); a key from Settings → Keys works too. An EU organization creates its key on app.eu.maple.dev. Hazel reads the organization from the key.",
	},
	// A Maple key is scoped per resource family; Hazel reads the product events through the MCP
	// tools, which is the only key-authenticated way into them.
	permissions: [{ resource: "MCP tools", access: "Read" }],
	webhook: null,
	syncMode: "Scheduled pull · hourly",
	configFields: [
		{
			_tag: "Select",
			key: "region",
			label: "Region",
			description: "Where the Maple organization lives. A key of one region is rejected by the other.",
			options: [
				{ value: "us", label: "US" },
				{ value: "eu", label: "EU" },
			],
		},
	],
	settings: {
		stringList: {
			key: "activityEvents",
			title: "Activity events",
			description:
				"A contact is active on a day they send one of these events. None: every event counts.",
			emptyText: "Every event counts as activity.",
			placeholder: "Event name, e.g. query_run",
			addLabel: "Add an activity event",
		},
		keyValueList: {
			key: "metricMappings",
			title: "Per-account metrics",
			description:
				"A daily count per account of each mapped event, under its metric key. Usable in charts and signals.",
			emptyText: "No event is mapped to a metric yet.",
			columns: [
				{ key: "event", label: "Event", placeholder: "dashboard_created" },
				{ key: "metricKey", label: "Metric key", placeholder: "dashboards_created" },
			],
			itemNoun: "metric",
			note: "Changing a key keeps history under the old key.",
			incompleteProblem: "Fill in or remove the empty metric rows",
		},
		number: {
			key: "lookbackDays",
			title: "Lookback",
			description: "How much history a backfill imports.",
			ariaLabel: "Lookback window",
			options: [
				{ value: 30, label: "30d" },
				{ value: 90, label: "90d" },
				{ value: 180, label: "180d" },
				{ value: 365, label: "1y" },
			],
			unit: "days",
		},
	},
	mapping: [
		{
			group: "Event → Account and contact",
			fields: [
				{ from: "GroupId", to: "shared id → the Clerk account (never created here)" },
				{ from: "UserId", to: "shared id → the Clerk contact (never created here)" },
				{ from: "an unknown GroupId", to: "unmatched record, with its event count" },
			],
		},
		{
			group: "Event → Activity",
			fields: [
				{ from: "events per day, per user", to: "activity_daily.eventCount" },
				{ from: "distinct SessionId per day", to: "activity_daily.sessionCount" },
				{ from: "a day with any event", to: "active users, usage trend, last active" },
			],
		},
		{
			group: "Event → Metrics",
			fields: [
				{ from: "mapped event count per day", to: "metric_daily.value (maple.<key>)" },
				{ from: "events sharing a key", to: "summed into it" },
			],
		},
	],
	docsHref: "https://maple.dev/docs/reference/mcp",
	dashboardHref: "https://app.maple.dev",
	sharedIdLabel: "GroupId",
	activityLabel: { noun: "events", usageRank: 10 },
}
