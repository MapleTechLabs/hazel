/**
 * Maple alert webhook payload types.
 * These match Maple's buildPayload() output (`AlertDestinationDelivery.ts` in the maple repo).
 */

export type MapleEventType = "trigger" | "resolve" | "renotify" | "test"
export type MapleIncidentStatus = "open" | "resolved"
export type MapleSeverity = "warning" | "critical"
/** The comparators Hazel can name; the payload carries any string (`MaplePayload`). */
export type MapleComparator = "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "between" | "not_between"
/** The signal types Hazel can name; the payload carries any string (`MaplePayload`). */
export type MapleSignalType =
	| "error_rate"
	| "p95_latency"
	| "p99_latency"
	| "apdex"
	| "throughput"
	| "builder_query"
	| "raw_query"
	| "uptime"

export interface MapleAlertRule {
	id: string
	name: string
	signalType: string
	severity: MapleSeverity
	groupKey: string | null
	comparator: string
	threshold: number
	thresholdUpper?: number | null
	windowMinutes: number
}

export interface MapleObserved {
	value: number | null
	sampleCount: number | null
	detail?: string | null
}

export interface MapleChart {
	sparkline?: string
	url?: string
}

export interface MapleAlertPayload {
	eventType: MapleEventType
	incidentId: string | null
	incidentStatus: MapleIncidentStatus
	dedupeKey: string
	rule: MapleAlertRule
	peakSeverity?: MapleSeverity | null
	observed: MapleObserved
	chart?: MapleChart | null
	linkUrl: string
	chatUrl: string
	sentAt: string
}
