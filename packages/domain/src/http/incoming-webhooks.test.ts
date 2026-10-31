import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { MaplePayload } from "./incoming-webhooks"

const decode = Schema.decodeUnknownSync(MaplePayload)

/** What Maple's `buildPayload` sends today (`AlertDestinationDelivery.ts`), extra keys included. */
const maplePayload = (rule: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
	event: { type: "alert.triggered" },
	eventType: "trigger",
	incidentId: "inc_1",
	incidentStatus: "open",
	dedupeKey: "rule_1:__total__",
	rule: {
		id: "rule_1",
		name: "checkout-api",
		signalType: "error_rate",
		severity: "critical",
		groupKey: "__total__",
		comparator: "gt",
		threshold: 5,
		thresholdUpper: null,
		windowMinutes: 5,
		severities: ["warning", "critical"],
		...rule,
	},
	peakSeverity: null,
	observed: { value: 7.82, sampleCount: 12480 },
	template: null,
	chart: null,
	linkUrl: "https://app.maple.dev/alerts/incidents/inc_1",
	chatUrl: "https://app.maple.dev/alerts/rules/rule_1",
	sentAt: "2026-10-31T14:06:00.000Z",
	...extra,
})

describe("MaplePayload", () => {
	it("decodes the signal types and comparators Maple added after the integration shipped", () => {
		for (const signalType of ["builder_query", "raw_query", "uptime"]) {
			expect(decode(maplePayload({ signalType })).rule.signalType).toBe(signalType)
		}
		for (const comparator of ["eq", "neq", "between", "not_between"]) {
			expect(decode(maplePayload({ comparator, thresholdUpper: 120 })).rule.comparator).toBe(comparator)
		}
	})

	it("decodes a signal type Hazel has never heard of", () => {
		expect(decode(maplePayload({ signalType: "saturation" })).rule.signalType).toBe("saturation")
	})

	it("keeps the range bound, the uptime error, the peak severity and the chart", () => {
		const payload = decode(
			maplePayload(
				{ comparator: "between", threshold: 40, thresholdUpper: 120 },
				{
					peakSeverity: "critical",
					observed: { value: 0, sampleCount: 3, detail: "Status 503, expected 2xx" },
					chart: { sparkline: "▁▂▅█", url: "https://app.maple.dev/chart/abc.png" },
				},
			),
		)
		expect(payload.rule.thresholdUpper).toBe(120)
		expect(payload.peakSeverity).toBe("critical")
		expect(payload.observed.detail).toBe("Status 503, expected 2xx")
		expect(payload.chart).toEqual({ sparkline: "▁▂▅█", url: "https://app.maple.dev/chart/abc.png" })
	})

	it("decodes a payload from before Maple sent the newer fields", () => {
		const { thresholdUpper: _, ...rule } = maplePayload({}).rule
		const { peakSeverity: __, chart: ___, ...legacy } = maplePayload({})
		expect(decode({ ...legacy, rule }).chart).toBeUndefined()
	})
})
