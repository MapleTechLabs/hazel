import type { BadgeIntent } from "../common/embed-types.ts"
import type { MapleEventType, MapleSeverity, MapleSignalType } from "./payloads.ts"

const COLOR_CRITICAL = 0xef4444
const COLOR_WARNING = 0xf59e0b
const COLOR_RESOLVED = 0x10b981
const COLOR_NEUTRAL = 0x6366f1

export interface MapleEventStyle {
	color: number
	label: string
	intent: BadgeIntent
}

/**
 * Map an event type + severity to a color, badge label, and intent.
 * Resolves are always green; triggers/renotifies follow severity; tests are neutral.
 */
export function getMapleEventStyle(eventType: MapleEventType, severity: MapleSeverity): MapleEventStyle {
	if (eventType === "resolve") {
		return { color: COLOR_RESOLVED, label: "Resolved", intent: "success" }
	}
	if (eventType === "test") {
		return { color: COLOR_NEUTRAL, label: "Test", intent: "info" }
	}
	const isCritical = severity === "critical"
	const color = isCritical ? COLOR_CRITICAL : COLOR_WARNING
	const intent: BadgeIntent = isCritical ? "danger" : "warning"
	const label = eventType === "renotify" ? "Re-notified" : "Triggered"
	return { color, label, intent }
}

const SIGNAL_LABELS: Record<MapleSignalType, string> = {
	error_rate: "Error rate",
	p95_latency: "P95 latency",
	p99_latency: "P99 latency",
	apdex: "Apdex",
	throughput: "Throughput",
	builder_query: "Query",
	raw_query: "SQL query",
	uptime: "Uptime",
}

/** A signal type Hazel does not know yet is shown as it came. */
export function formatSignalType(signal: string): string {
	return Object.hasOwn(SIGNAL_LABELS, signal) ? SIGNAL_LABELS[signal as MapleSignalType] : signal
}

export function severityIntent(severity: MapleSeverity): BadgeIntent {
	return severity === "critical" ? "danger" : "warning"
}
