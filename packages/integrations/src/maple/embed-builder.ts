import { WEBHOOK_BOT_CONFIGS } from "../common/bot-configs.ts"
import type { MessageEmbed, MessageEmbedField } from "../common/embed-types.ts"
import { formatSignalType, getMapleEventStyle, severityIntent } from "./colors.ts"
import type { MapleAlertPayload, MapleAlertRule, MapleComparator } from "./payloads.ts"

const mapleConfig = WEBHOOK_BOT_CONFIGS.maple

const COMPARATOR_LABEL: Record<MapleComparator, string> = {
	gt: ">",
	gte: "≥",
	lt: "<",
	lte: "≤",
	eq: "=",
	neq: "≠",
	between: "between",
	not_between: "not between",
}

/** Maple's group key for an ungrouped rule: "the whole rule", not a group anyone named. */
const UNGROUPED_GROUP_KEY = "__total__"

function formatNumber(value: number): string {
	if (!Number.isFinite(value)) return String(value)
	if (Math.abs(value) >= 1000 || Number.isInteger(value)) {
		return value.toLocaleString("en-US", { maximumFractionDigits: 2 })
	}
	return value.toFixed(2)
}

/** The breach condition, e.g. `> 5` or `between 40 and 120`; an unknown comparator as it came. */
function formatCondition(rule: MapleAlertRule): string {
	const operator = Object.hasOwn(COMPARATOR_LABEL, rule.comparator)
		? COMPARATOR_LABEL[rule.comparator as MapleComparator]
		: rule.comparator
	if (rule.comparator === "between" || rule.comparator === "not_between") {
		return `${operator} ${formatNumber(rule.threshold)} and ${formatNumber(rule.thresholdUpper ?? rule.threshold)}`
	}
	return `${operator} ${formatNumber(rule.threshold)}`
}

function describe(payload: MapleAlertPayload, signalLabel: string): string {
	const { eventType, rule, observed } = payload
	if (eventType === "test") return `Test alert for ${signalLabel.toLowerCase()}.`
	if (rule.signalType === "uptime") {
		// An uptime rule's value is a 0/1 check result: the check's error says more.
		return eventType === "resolve"
			? "Checks are passing again."
			: (observed.detail ?? "Checks are failing.")
	}
	if (eventType === "resolve") return `${signalLabel} returned to healthy range.`
	return `${signalLabel} ${formatCondition(rule)} over ${rule.windowMinutes}m.`
}

/**
 * Build embed for a Maple alert webhook event.
 * Renders trigger / resolve / renotify / test events with severity-aware coloring.
 */
export function buildMapleEmbed(payload: MapleAlertPayload): MessageEmbed {
	const { eventType, rule, observed, linkUrl, sentAt } = payload
	const style = getMapleEventStyle(eventType, rule.severity)
	const signalLabel = formatSignalType(rule.signalType)
	const groupKey = rule.groupKey === UNGROUPED_GROUP_KEY ? null : rule.groupKey

	const title = groupKey ? `${rule.name} — ${groupKey}` : rule.name

	const fields: MessageEmbedField[] = []

	// A resolve says how bad the incident got, which can be worse than the rule's own severity.
	const peak = eventType === "resolve" ? (payload.peakSeverity ?? null) : null
	const severity = peak ?? rule.severity
	fields.push({
		name: peak === null ? "Severity" : "Peak severity",
		value: severity === "critical" ? "Critical" : "Warning",
		type: "badge",
		options: { intent: severityIntent(severity) },
		inline: true,
	})

	fields.push({
		name: "Signal",
		value: signalLabel,
		inline: true,
	})

	if (observed.value !== null && rule.signalType !== "uptime") {
		const observedValue = `${formatNumber(observed.value)} (threshold ${formatCondition(rule)})`
		fields.push({
			name: "Observed",
			value: observedValue,
			inline: false,
		})
	}

	fields.push({
		name: "Window",
		value: `${rule.windowMinutes}m`,
		inline: true,
	})

	if (groupKey) {
		fields.push({
			name: "Group",
			value: groupKey,
			inline: true,
		})
	}

	if (observed.sampleCount !== null) {
		fields.push({
			name: "Samples",
			value: String(observed.sampleCount),
			inline: true,
		})
	}

	return {
		title,
		description: describe(payload, signalLabel),
		url: linkUrl,
		color: style.color,
		author: {
			name: "Maple",
			url: "https://maple.dev",
			iconUrl: mapleConfig.avatarUrl,
		},
		footer: {
			// Without the chart image, Maple's sparkline still shows the trend.
			text:
				payload.chart?.sparkline && !payload.chart.url
					? `Maple Alerts · ${payload.chart.sparkline}`
					: "Maple Alerts",
			iconUrl: mapleConfig.avatarUrl,
		},
		// Maple's own chart of what the alert saw, pinned to its window.
		image: payload.chart?.url ? { url: payload.chart.url } : undefined,
		thumbnail: undefined,
		fields: fields.length > 0 ? fields : undefined,
		timestamp: sentAt,
		badge: {
			text: style.label,
			color: style.color,
		},
	}
}
