/**
 * Maple product events and `run_sql` answers shaped from real ones.
 *
 * The ids, hosts, event names and shapes come from Maple's own `product_events` (the dogfood
 * organization, read over the MCP endpoint while this adapter was written) and from
 * `maple/docs/product-events-catalog.md`:
 *
 * - `GroupId` is the Clerk organization id, `UserId` the Clerk user id, and about 95% of
 *   `$pageview` rows on the app host carry both; marketing rows on `maple.dev` carry neither.
 * - A browser event always has a `SessionId`; a server one (`plan_started`) has an organization
 *   but no user and no session.
 * - `$pageview` is the volume event, the `*_created` events the deliberate ones.
 */
import type { MapleEvent } from "./testing"

/** The Maple organization the fixture key opens. */
export const MAPLE_ORG = "org_39lDNgEjuXrOi0obeLpFSfyVSDo"

/** Two Clerk organizations Maple reports usage for, and one it reports but Clerk does not hold. */
export const ORG_ACME = "org_3AuiNCIuD1XCbbzcjkzE3s5HoQj"
export const ORG_GLOBEX = "org_3A3BBvbqEmNHHV2K07gweXLwA1U"
export const ORG_UNKNOWN = "org_3LsFPV5euzmkuYvanvIzIiOLuFh"

export const USER_ADA = "user_39gP858vUksrA7uoGJ3Y9fa8sZM"
export const USER_LIN = "user_3BU6HrCe3nTMKFCvymFTEUlHD7m"
export const USER_GLOBEX = "user_3A3BBGQ1zv3inaIeM9bJ6KwDQHB"

const event = (
	day: string,
	groupId: string,
	userId: string,
	sessionId: string,
	eventName: string,
): MapleEvent => ({ day, groupId, userId, sessionId, eventName })

/** A day of app usage: two Acme users in two sessions each, one Globex user, one dashboard made. */
export const DAY_ONE: ReadonlyArray<MapleEvent> = [
	event("2026-06-14", ORG_ACME, USER_ADA, "ses_a1", "$pageview"),
	event("2026-06-14", ORG_ACME, USER_ADA, "ses_a1", "$pageview"),
	event("2026-06-14", ORG_ACME, USER_ADA, "ses_a2", "$pageview"),
	event("2026-06-14", ORG_ACME, USER_ADA, "ses_a2", "dashboard_created"),
	event("2026-06-14", ORG_ACME, USER_LIN, "ses_l1", "$pageview"),
	event("2026-06-14", ORG_GLOBEX, USER_GLOBEX, "ses_g1", "$pageview"),
	event("2026-06-14", ORG_GLOBEX, USER_GLOBEX, "ses_g1", "alert_rule_created"),
]

/**
 * The next day, with the rows Hazel must leave out: a marketing page view with no identity at all,
 * a server-side plan event with an organization but no user or session (it counts for a metric, not
 * for a person's activity), and usage for a group Clerk does not hold.
 */
export const DAY_TWO: ReadonlyArray<MapleEvent> = [
	event("2026-06-15", ORG_ACME, USER_ADA, "ses_a3", "$pageview"),
	event("2026-06-15", ORG_ACME, USER_ADA, "ses_a3", "dashboard_created"),
	event("2026-06-15", "", "", "ses_m1", "$pageview"),
	event("2026-06-15", "", "", "ses_m1", "page_scrolled"),
	event("2026-06-15", ORG_ACME, "", "", "plan_started"),
	event("2026-06-15", ORG_UNKNOWN, "user_3LsFMSVVn6hheSNGK8KtkKUqwaE", "ses_u1", "$pageview"),
]

export const EVENTS: ReadonlyArray<MapleEvent> = [...DAY_ONE, ...DAY_TWO]

/**
 * One `run_sql` answer as Maple sends it, kept verbatim so the decoding is pinned to the real
 * envelope: `structuredContent` beside the text block, counts as numbers, and the macro-expanded
 * statement under `expandedSql` when `show_sql` asked for it.
 */
export const RUN_SQL_ANSWER = {
	jsonrpc: "2.0",
	id: 1,
	result: {
		content: [{ type: "text", text: "SQL result\n2 rows" }],
		structuredContent: {
			rowCount: 2,
			columns: ["day", "account", "contact", "events", "sessions"],
			rows: [
				{
					day: "2026-11-09",
					account: ORG_ACME,
					contact: USER_ADA,
					events: 26,
					sessions: 4,
				},
				{
					day: "2026-11-09",
					account: ORG_ACME,
					contact: USER_LIN,
					events: 21,
					sessions: 5,
				},
			],
			truncated: false,
			timeRange: { start: "2026-11-09 00:00:00", end: "2026-11-10 00:00:00" },
			maxCellChars: 120,
			windowApplied: true,
			expandedSql: `SELECT * FROM (\nSELECT toDate(Timestamp) AS day FROM product_events WHERE (OrgId = '${MAPLE_ORG}')\n) AS maple_raw_sql_limited\nLIMIT 1000`,
		},
	},
} as const
