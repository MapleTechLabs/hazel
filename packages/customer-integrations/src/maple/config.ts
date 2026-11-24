import { Effect, Schema } from "effect"

/**
 * Which Maple region the key belongs to: its API lives on another host per region, and a key of one
 * region is refused by the other.
 */
export const MapleRegion = Schema.Literals(["us", "eu"])
export type MapleRegion = typeof MapleRegion.Type

/**
 * Maple: product events by GroupId/UserId → activity and per-event metrics, pulled on a schedule.
 * The organization is the one the key opens (read at connect). Configs stored before carry
 * `mapleOrgId`, `accountKey` and `userKey` too; decoding drops them.
 */
export const MapleConnectionConfig = Schema.TaggedStruct("maple", {
	/** Added after the first connections were stored, so an older config decodes as `us`. */
	region: MapleRegion.pipe(Schema.withDecodingDefaultKey(Effect.succeed("us" as const))),
	/** Event names that count as activity; empty = every event. Spelled out in each pull's query. */
	activityEvents: Schema.Array(Schema.String).check(Schema.isMaxLength(100)),
	/** Event name → metric key written per account per day. Spelled out in each pull's query. */
	metricMappings: Schema.Array(Schema.Struct({ event: Schema.String, metricKey: Schema.String })).check(
		Schema.isMaxLength(50),
	),
	/** 1–365. */
	lookbackDays: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 365 })),
})
export type MapleConnectionConfig = typeof MapleConnectionConfig.Type

export const DEFAULT_MAPLE_CONFIG: MapleConnectionConfig = {
	_tag: "maple",
	region: "us",
	activityEvents: [],
	metricMappings: [],
	lookbackDays: 90,
}

/** The region half of the connection's account id, from what `validate` stored. */
export const regionOfAccountId = (externalAccountId: string | null): MapleRegion | null => {
	if (externalAccountId === null) return null
	if (externalAccountId.endsWith(":us")) return "us"
	return externalAccountId.endsWith(":eu") ? "eu" : null
}
