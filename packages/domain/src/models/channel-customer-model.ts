/**
 * A linked channel's customer as the `OrgObject` holds it (`channel_customers`, projected by the
 * `CustomersObject`): what chat shows on the channel. Keyed by `channelId`.
 *
 * Beyond the name, the account at a glance (`docs/customers/channels.md`, "In the channel"): health
 * and why, stage, plan, MRR, owner, seats, last active day, open signals and the provider deep
 * links. A row written before these existed (or by an older snapshot) has them null or empty.
 */
import { ChannelId, CustomerAccountId, CustomerSignalId, OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import {
	CustomerProvider,
	HealthStatus,
	LifecycleStage,
	SignalKind,
	SignalSeverity,
} from "../customers/enums"
import { JsonDate } from "./utils"

/** One of the customer's top open signals. */
export const Signal = S.Struct({
	id: CustomerSignalId,
	title: S.String,
	reason: S.String,
	kind: SignalKind,
	severity: SignalSeverity,
})
export type Signal = typeof Signal.Type

/** A deep link to the customer's record in a provider's dashboard. */
export const SourceLink = S.Struct({ provider: CustomerProvider, url: S.String })
export type SourceLink = typeof SourceLink.Type

/** At most this many signals ride along; `openSignalCount` has them all. */
export const TOP_SIGNALS = 3

export const Schema = S.Struct({
	channelId: ChannelId,
	organizationId: OrganizationId,
	accountId: CustomerAccountId,
	accountName: S.String,
	/** Optional: rows synced or cached before logos were projected have none. */
	accountLogoUrl: S.optional(S.NullOr(S.String)),
	healthStatus: HealthStatus,
	healthScore: S.NullOr(S.Int),
	/** The weakest health component's plain reason; null without a score. */
	healthWhy: S.NullOr(S.String),
	lifecycleStage: S.NullOr(LifecycleStage),
	planName: S.NullOr(S.String),
	/** Summed over the customer's environments in its currency. */
	mrrMinor: S.NullOr(S.Int),
	currency: S.NullOr(S.String),
	ownerUserId: S.NullOr(UserId),
	seatsUsed: S.NullOr(S.Int),
	seatsLimit: S.NullOr(S.Int),
	/** `YYYY-MM-DD` (UTC) of the latest activity: a day, so activity does not resend it hourly. */
	lastActiveDay: S.NullOr(S.String),
	openSignalCount: S.Int,
	topSignals: S.Array(Signal),
	sourceLinks: S.Array(SourceLink),
	updatedAt: JsonDate,
})
export type Type = typeof Schema.Type
