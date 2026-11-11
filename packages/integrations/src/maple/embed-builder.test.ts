import { describe, expect, it } from "vitest"
import { buildMapleEmbed } from "./embed-builder"
import type { MapleAlertPayload, MapleAlertRule } from "./payloads"

const payload = (
	rule: Partial<MapleAlertRule> = {},
	extra: Partial<MapleAlertPayload> = {},
): MapleAlertPayload => ({
	eventType: "trigger",
	incidentId: "inc_1",
	incidentStatus: "open",
	dedupeKey: "rule_1:region=eu-west-1",
	rule: {
		id: "rule_1",
		name: "checkout-api error rate",
		signalType: "error_rate",
		severity: "critical",
		groupKey: "region=eu-west-1",
		comparator: "gt",
		threshold: 5,
		thresholdUpper: null,
		windowMinutes: 5,
		...rule,
	},
	observed: { value: 7.82, sampleCount: 12480 },
	linkUrl: "https://app.maple.dev/alerts/incidents/inc_1",
	chatUrl: "https://app.maple.dev/alerts/rules/rule_1",
	sentAt: "2026-10-31T14:06:00.000Z",
	...extra,
})

const field = (embed: ReturnType<typeof buildMapleEmbed>, name: string) =>
	embed.fields?.find((candidate) => candidate.name === name)?.value

describe("buildMapleEmbed", () => {
	it("describes a threshold breach", () => {
		const embed = buildMapleEmbed(payload())
		expect(embed.title).toBe("checkout-api error rate — region=eu-west-1")
		expect(embed.description).toBe("Error rate > 5 over 5m.")
		expect(field(embed, "Observed")).toBe("7.82 (threshold > 5)")
		expect(embed.badge?.text).toBe("Triggered")
	})

	it("names both bounds of a range rule", () => {
		const embed = buildMapleEmbed(
			payload(
				{
					signalType: "builder_query",
					comparator: "not_between",
					threshold: 40,
					thresholdUpper: 120,
				},
				{ observed: { value: 22, sampleCount: 10 } },
			),
		)
		expect(embed.description).toBe("Query not between 40 and 120 over 5m.")
		expect(field(embed, "Observed")).toBe("22 (threshold not between 40 and 120)")
	})

	it("shows an uptime check's error instead of its 0/1 value", () => {
		const embed = buildMapleEmbed(
			payload(
				{ name: "api.hazel.sh/health", signalType: "uptime", comparator: "lt", threshold: 1 },
				{ observed: { value: 0, sampleCount: 3, detail: "Status 503, expected 2xx" } },
			),
		)
		expect(embed.description).toBe("Status 503, expected 2xx")
		expect(field(embed, "Signal")).toBe("Uptime")
		expect(field(embed, "Observed")).toBeUndefined()
		expect(buildMapleEmbed(payload({ signalType: "uptime" }, { eventType: "resolve" })).description).toBe(
			"Checks are passing again.",
		)
	})

	it("shows a signal type and comparator it does not know as they came", () => {
		const embed = buildMapleEmbed(payload({ signalType: "saturation", comparator: "approx" }))
		expect(embed.description).toBe("saturation approx 5 over 5m.")
	})

	it("leaves out Maple's group key for an ungrouped rule", () => {
		const embed = buildMapleEmbed(payload({ groupKey: "__total__" }))
		expect(embed.title).toBe("checkout-api error rate")
		expect(field(embed, "Group")).toBeUndefined()
	})

	it("reports the incident's peak severity on resolve", () => {
		const embed = buildMapleEmbed(
			payload({ severity: "warning" }, { eventType: "resolve", peakSeverity: "critical" }),
		)
		expect(field(embed, "Peak severity")).toBe("Critical")
		expect(field(embed, "Severity")).toBeUndefined()
		expect(field(buildMapleEmbed(payload({}, { peakSeverity: "critical" })), "Severity")).toBe("Critical")
	})

	it("shows Maple's chart, or its sparkline when there is no image", () => {
		const withImage = buildMapleEmbed(
			payload({}, { chart: { sparkline: "▁▂▅█", url: "https://app.maple.dev/chart/abc.png" } }),
		)
		expect(withImage.image).toEqual({ url: "https://app.maple.dev/chart/abc.png" })
		expect(withImage.footer?.text).toBe("Maple Alerts")

		const sparklineOnly = buildMapleEmbed(payload({}, { chart: { sparkline: "▁▂▅█" } }))
		expect(sparklineOnly.image).toBeUndefined()
		expect(sparklineOnly.footer?.text).toBe("Maple Alerts · ▁▂▅█")
	})
})
