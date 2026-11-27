/**
 * What a source shows, as data (today's `web-foldkit/.../settings/sources/{model,parts}.ts`): its
 * state, its record counts, the copy for a failed sync or connect. No views.
 */
import type * as Customers from "@hazel/domain/customers"
import type { CustomerConnectionId } from "@hazel/schema"
import { Match, Schema } from "effect"
import { CommonReason, copyOf, type ErrorCopy } from "../../../modals/feedback"
import { formatCount } from "../../data/format"
import { providerOf } from "../../data/providers"
import type { ConnectionRow, SyncRunRow } from "./rows"

// STATE

export type SourceStatus = "connected" | "syncing" | "failing" | "disconnected"

export const connectionOf = (
	connections: ReadonlyArray<ConnectionRow> | null,
	provider: Customers.CustomerProvider,
): ConnectionRow | undefined => connections?.find((connection) => connection.provider === provider)

/** Connected, failing or syncing; a disconnected connection's data stays, marked stale. */
export const isLive = (connection: ConnectionRow): boolean => connection.status !== "disconnected"

/** The connection's running run, if one is. */
export const runningRunOf = (
	runs: ReadonlyArray<SyncRunRow> | null,
	connectionId: CustomerConnectionId,
): SyncRunRow | undefined =>
	(runs ?? []).find((run) => run.connectionId === connectionId && run.status === "running")

export const statusOf = (runs: ReadonlyArray<SyncRunRow> | null, connection: ConnectionRow): SourceStatus =>
	connection.status === "disconnected"
		? "disconnected"
		: connection.status === "error"
			? "failing"
			: runningRunOf(runs, connection.id) === undefined
				? "connected"
				: "syncing"

// RECORDS

const STAT_LABELS = [
	["accounts", "account", "accounts"],
	["contacts", "contact", "contacts"],
	["subscriptions", "subscription", "subscriptions"],
	["invoices", "invoice", "invoices"],
	["events", "event", "events"],
	["activityDays", "activity day", "activity days"],
	["metricDays", "metric day", "metric days"],
	["unmatched", "unmatched", "unmatched"],
] as const satisfies ReadonlyArray<readonly [keyof Customers.SyncStats, string, string]>

/** `412 accounts`, `3,180 contacts`, ...: the counts a sync wrote, zeros left out. */
export const statParts = (stats: Customers.SyncStats): ReadonlyArray<string> =>
	STAT_LABELS.filter(([key]) => stats[key] > 0).map(
		([key, one, many]) => `${formatCount(stats[key])} ${stats[key] === 1 ? one : many}`,
	)

// TIME

/** `11:20`, local. */
export const formatClock = (ms: number): string =>
	new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms)

/** `0.4s`, `41s`, `6m 12s`, `1h 4m`. */
export const formatDuration = (ms: number): string => {
	const seconds = ms / 1000
	if (seconds < 1) return `${Math.max(0.1, Math.round(seconds * 10) / 10)}s`
	if (seconds < 60) return `${Math.round(seconds)}s`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export const TRIGGER_LABEL = {
	schedule: "Schedule",
	webhook: "Webhook",
	manual: "Manual",
	backfill: "Backfill",
} as const satisfies Record<Customers.SyncTrigger, string>

// ERRORS

/**
 * A failed sync in our words, from its code and HTTP status. The error's `message` is the
 * provider's text and is never shown.
 */
export const syncErrorMessage = (error: Customers.SyncError, name: string): Required<ErrorCopy> => {
	const status = error.httpStatus === null ? "" : ` (HTTP ${error.httpStatus})`
	return Match.value(error.code).pipe(
		Match.when("auth", () => ({
			title: "API key revoked or invalid",
			description: `${name} refused the key${status}. Syncing is paused until you reconnect.`,
		})),
		Match.when("rate_limited", () => ({
			title: `Rate limited by ${name}`,
			description: `${name} asked Hazel to slow down${status}. Syncs retry with backoff.`,
		})),
		Match.when("provider", () => ({
			title: `${name} returned an error`,
			description: `The request failed on ${name}'s side${status}. Syncs retry with backoff.`,
		})),
		Match.when("network", () => ({
			title: `Couldn't reach ${name}`,
			description: "The connection failed before an answer. Syncs retry with backoff.",
		})),
		Match.when("internal", () => ({
			title: "Sync failed in Hazel",
			description: "Something broke on our side. Syncs retry with backoff.",
		})),
		Match.exhaustive,
	)
}

/**
 * What a connect, a key rotation or a settings save can answer beyond the shared reasons: the
 * provider refused the key, could not be reached to check it, has no integration yet, the request
 * was refused as malformed, or the connection is gone.
 */
export const ConnectFailure = Schema.Union([
	Schema.Literals(["Refused", "Unreachable", "ComingSoon", "Invalid", "NotFound"]),
	CommonReason,
])
export type ConnectFailure = typeof ConnectFailure.Type

/** What a connect, a key rotation or a settings save says when it fails. */
export const connectFailureMessage = (
	reason: ConnectFailure,
	provider: Customers.CustomerProvider,
): ErrorCopy => {
	const name = providerOf(provider).name
	return copyOf(reason, {
		Refused: {
			title: "Key was refused",
			description: `${name} did not accept this key. Check that it is live and has the permissions listed, then test again. Nothing was imported.`,
		},
		Unreachable: {
			title: `Couldn't reach ${name}`,
			description: "The key could not be checked right now. Try again in a moment.",
		},
		ComingSoon: {
			title: `The ${name} integration is coming soon`,
			description: "Hazel can't sync from it yet. Nothing was stored.",
		},
		Invalid: {
			title: "Hazel couldn't use these settings",
			description: "Check the fields and try again.",
		},
		NotFound: { title: "This connection is gone", description: "It was disconnected meanwhile." },
	})
}
