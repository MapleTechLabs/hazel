// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { UiSchema } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerIssueId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { formatDueAt, type IssueSlaRow } from "../data/sla"
import { NO_VALUE, kindChip, severityChip, signalCounts, signalCountsLabel, stageBadge } from "./badges"
import { connectCard } from "./connect-card"
import { noResultsState } from "./empty-states"
import { evidenceDetail, evidenceViz } from "./evidence"
import {
	addFilterButton,
	filterBar,
	filterChip,
	rangePicker,
	searchBox,
	shortcutBar,
	viewTabs,
} from "./filter-bar"
import { companyLogo, initialsOf, personAvatar, safeLogoUrl, sourceLogoSrc, tintOf } from "./identity"
import { deltaLook, kpiTile } from "./kpi-tile"
import { planLine, queueAction, queueRow, queueTable } from "./queue-row"
import { slaChip } from "./sla-chip"
import { lookOf, viewGlyph } from "./view-look"

/** The customers kit, drawn by a harness that logs every message it gets (plain props in, events out). */

const KitMessage = UiSchema.TaggedEnum({ Got: { what: Schema.String } })
type KitMessage = typeof KitMessage.Type
const got = (what: string) => KitMessage.Got({ what })

const harness = (view: (h: Hazel.H<KitMessage>) => Hazel.NoTextInput<KitMessage>) =>
	Hazel.component({
		name: "CustomersKit",
		props: Schema.Struct({}),
		model: Schema.Struct({ log: Schema.Array(Schema.String) }),
		message: KitMessage,
	}).make({
		init: () => ({ log: [] }),
		update: { Got: ($, { what }) => $.evolve({ log: (log) => [...log, what] }) },
		// Scene shows no Model: the log is drawn as a divider's label, which no kit piece uses.
		view: (h, model) => h.stack.children(view(h), h.listDivider.label(model.log.join(" | "))),
	})

const logOf = (s: { get: (locator: Locator.Locator) => Locator.Node }) =>
	String(s.get(tagged("listDivider")).props?.["label"] ?? "")
		.split(" | ")
		.filter((entry) => entry !== "")

const draw = (view: Parameters<typeof harness>[0]) => Scene.start(harness(view), {})

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const tagged = (tag: string) => Locator.tag(`hz:${tag}`)
const textOf = Locator.textOf
const texts = (s: { all: (locator: Locator.Locator) => ReadonlyArray<Locator.Node> }) =>
	s.all(tagged("text")).map(textOf)

const NOW = new Date("2026-11-20T12:00:00Z")
const days = (values: ReadonlyArray<number>) =>
	values.map((value, index) => ({ day: `2026-11-${String(index + 1).padStart(2, "0")}`, value }))

const usageDrop: Customers.SignalEvidence = {
	_tag: "series",
	step: 1,
	metricKey: "api_calls",
	recentAvg: 25,
	baselineAvg: 44,
	changePct: -43,
	recentDays: 7,
	baselineDays: 23,
	series: days([44, 45, 43, 46, 44, 42, 45, 26, 24, 25, 27, 23, 25, 26]),
}
const pastDue: Customers.SignalEvidence = {
	_tag: "amount",
	step: 0,
	amountMinor: 124_000,
	currency: "USD",
	invoiceId: null,
	invoiceNumber: "INV-0042",
	subscriptionStatus: null,
	dueAt: null,
	daysOverdue: 6,
	attemptCount: 3,
	declineReason: null,
	nextRetryAt: null,
}

describe("identity", () => {
	test("initials and logo URLs read as today's", () => {
		expect(initialsOf("Northwind Labs")).toBe("NL")
		expect(initialsOf("kestrel")).toBe("KE")
		expect(initialsOf("north-wind")).toBe("NW")
		expect(initialsOf("  ")).toBe("?")
		expect(safeLogoUrl("https://img.clerk.com/acme.png")).toBe("https://img.clerk.com/acme.png")
		expect(safeLogoUrl("http://acme.io/logo.png")).toBeNull()
		expect(safeLogoUrl("data:image/svg+xml,<svg/>")).toBeNull()
		expect(sourceLogoSrc("hazel")).toBe("/icon.svg")
		expect(sourceLogoSrc("stripe")).toMatch(/^https:\/\/cdn\.brandfetch\.io\/stripe\.com\//)
	})

	test("a logo falls back to initials; an unsafe picture is never drawn", () => {
		const s = draw((h) =>
			h.stack.children(
				companyLogo(h, { name: "Northwind Labs", logoUrl: "http://acme.io/logo.png" }),
				companyLogo(h, { name: "Kestrel", size: "2xs" }),
				companyLogo(h, { name: "Acme", logoUrl: "https://acme.io/logo.png", size: "lg" }),
				personAvatar(h, null),
			),
		)
		const avatars = s.all(tagged("avatar")).map((node) => node.props)
		expect(avatars).toEqual([
			{ initials: "NL", size: "row", corners: "square", tint: tintOf("Northwind Labs") },
			{ initials: "K", size: "xxsmall", corners: "square", tint: tintOf("Kestrel") },
			{
				initials: "AC",
				src: "https://acme.io/logo.png",
				size: "large",
				corners: "square",
				tint: tintOf("Acme"),
			},
			{ size: "xsmall", placeholder: true },
		])
	})
})

describe("badges", () => {
	test("severity, kind and stage keep today's labels and intents", () => {
		const s = draw((h) =>
			h.stack.children(
				severityChip(h, "high"),
				kindChip(h, "risk"),
				kindChip(h, "opportunity"),
				stageBadge(h, "trialing", { trialDaysLeft: 4 }),
				stageBadge(h, "churned"),
			),
		)
		expect(s.all(tagged("badge")).map((node) => node.props)).toEqual([
			{ label: "High", style: "outline", severity: "high" },
			{ label: "Risk", tone: "danger", icon: "risk" },
			{ label: "Opportunity", tone: "info", icon: "opportunity" },
			{ label: "Trialing", tone: "info", detail: "· 4 days left" },
			{ label: "Churned", style: "quietOutline" },
		])
	})

	test("signal counts name each non-zero count, and a dash for none", () => {
		const counts = { high: 2, medium: 0, low: 1, opportunities: 1 }
		expect(signalCountsLabel(counts)).toBe("2 high risk, 1 low risk, 1 opportunity")
		const drawn = draw((h) => h.stack.children(signalCounts(h, counts)))
		expect(drawn.all(tagged("badge")).map((node) => node.props)).toEqual([
			{ label: "2", style: "plain", severity: "high" },
			{ label: "1", style: "plain", severity: "low" },
			{ label: "1", style: "plain", tone: "info", icon: "opportunity" },
		])
		const none = draw((h) =>
			h.stack.children(signalCounts(h, { high: 0, medium: 0, low: 0, opportunities: 0 })),
		)
		expect(texts(none)).toEqual([NO_VALUE])
	})
})

describe("SLA chip", () => {
	const breached: IssueSlaRow = {
		id: CustomerIssueId.make("00000000-0000-4000-8000-000000000001"),
		accountId: CustomerAccountId.make("00000000-0000-4000-8000-000000000002"),
		policyName: "Standard",
		targets: Customers.DEFAULT_SLA_POLICY.targets,
		state: Customers.openSla(
			{
				targets: Customers.DEFAULT_SLA_POLICY.targets,
				calendar: { _tag: "always" },
				warnBeforePct: 25,
			},
			"urgent",
			NOW.getTime() - 2 * 60 * 60_000,
		),
	}

	test("a breached reply is danger; no policy draws nothing", () => {
		const s = draw((h) =>
			h.stack.children(
				slaChip(h, { sla: breached, nowMs: NOW.getTime() }),
				slaChip(h, { sla: undefined, nowMs: 0 }),
			),
		)
		expect(s.all(tagged("badge")).map((node) => node.props)).toEqual([
			{
				label: "Reply overdue by 1h",
				tone: "danger",
				icon: "clock",
				// Due an hour before now, in the viewer's own time zone.
				title: `Standard policy · was due ${formatDueAt(NOW.getTime() - 60 * 60_000, NOW.getTime())}`,
			},
		])
	})
})

describe("evidence", () => {
	test("a usage drop is a falling sparkline with its change; past due money says how late", () => {
		const s = draw((h) => h.stack.children(evidenceViz(h, usageDrop), evidenceViz(h, pastDue)))
		const chart = s.get(tagged("chart"))
		expect(chart.props).toMatchObject({ kind: "sparkline", label: "api_calls: −43% over 7 days" })
		expect(chart.props?.["series"]).toMatchObject([{ tone: "churn" }])
		expect(texts(s)).toEqual(["−43%", "$1,240", "6d overdue"])
	})

	test("the detail lists the facts and highlights the recent bars", () => {
		const s = draw((h) => h.stack.children(evidenceDetail(h, usageDrop, { now: NOW })))
		expect(s.get(tagged("chart")).props).toMatchObject({
			kind: "barSparkline",
			highlightFrom: 7,
			net: true,
		})
		expect(s.all(tagged("property")).map((node) => node.props?.label)).toEqual([
			"Last 7 days avg",
			"Prior 23 days avg",
			"Change",
		])
		expect(texts(s)).toEqual(["25", "44", "−43%"])
	})
})

describe("queue", () => {
	const row = (
		h: Hazel.H<KitMessage>,
		rank: number,
		run?: { continuesAbove: boolean; continuesBelow: boolean },
	) =>
		queueRow(h, {
			id: `row-${rank}`,
			rank,
			account: {
				name: "Northwind",
				logoUrl: null,
				planName: "Growth",
				mrrMinor: 215_000,
				currency: "USD",
			},
			signal: { kind: "risk", severity: "high", title: "Usage dropped", reason: "API calls down 43%" },
			evidence: evidenceViz(h, usageDrop),
			age: "2d",
			assignee: null,
			isFocused: rank === 1,
			run,
			onPress: got(`row ${rank}`),
			actions:
				rank === 1
					? [queueAction(h, { label: "Assign", icon: "user", onPress: got("assign") })]
					: undefined,
		})

	test("rows press, report sort and keep the account to the first of its run", () => {
		const s = draw((h) =>
			queueTable(h, { label: "Needs attention", onSort: (column) => got(`sort ${column}`) }, [
				row(h, 1, { continuesAbove: false, continuesBelow: true }),
				row(h, 2, { continuesAbove: true, continuesBelow: false }),
			]),
		)
		expect(s.all(tagged("tableRow")).map((node) => node.props?.["current"])).toEqual([true, undefined])
		expect(
			s.all(byProp("text", "truncate", true)).filter((node) => textOf(node) === "Northwind"),
		).toHaveLength(1)
		const after = s
			.fire(byProp("tableRow", "key", "row-2"), "press")
			.fire(byProp("button", "label", "Assign"), "press")
			.fire(tagged("table"), "sort", { column: "age" })
		expect(logOf(after)).toEqual(["row 2", "assign", "sort age"])
		expect(planLine({ name: "", logoUrl: null, planName: null, mrrMinor: 0, currency: "USD" }, 2)).toBe(
			"No plan · $0/mo · +2 environments",
		)
	})
})

describe("controls", () => {
	test("tabs, range, search, chips and the filter button report the caller's messages", () => {
		const s = draw((h) =>
			h.stack.children(
				viewTabs(h, {
					tabs: [
						{ key: "open", label: "Open", count: 12 },
						{ key: "done", label: "Done" },
					],
					selected: "open",
					onSelect: (key) => got(`tab ${key}`),
				}),
				filterBar(h, {
					start: [
						searchBox(h, {
							value: TextField.empty,
							placeholder: "Search",
							onChange: ({ value }) => got(`search ${value}`),
						}),
						filterChip(h, {
							field: "Kind",
							operator: "is",
							value: "Risk",
							onRemove: got("remove kind"),
						}),
						addFilterButton(h, { onPress: got("add filter") }),
					],
					end: [rangePicker(h, { selected: "30d", onSelect: (range) => got(`range ${range}`) })],
				}),
				shortcutBar(h, [{ keys: ["j", "k"], label: "Navigate" }]),
			),
		)
		expect(s.get(tagged("tabBar")).props).toMatchObject({
			style: "page",
			selected: "open",
			tabs: [
				{ id: "open", label: "Open", badge: 12 },
				{ id: "done", label: "Done" },
			],
		})
		const after = s
			.fire(tagged("tabBar"), "change", { id: "done" })
			.fire(tagged("choiceGroup"), "change", { selected: ["90d"] })
			.fire(tagged("searchField"), "change", { value: "acme", rev: 1, edit: 0 })
			.fire(byProp("button", "detail", "Kind is"), "remove")
			.fire(byProp("button", "label", "Filter"), "press")
		expect(logOf(after)).toEqual(["tab done", "range 90d", "search acme", "remove kind", "add filter"])
		expect(s.all(byProp("text", "role", "kbd")).map(textOf)).toEqual(["j", "k"])
	})
})

describe("cards and tiles", () => {
	test("a connect card shows its state and its way out", () => {
		const s = draw((h) =>
			h.stack.children(
				connectCard(h, {
					provider: "stripe",
					now: NOW,
					status: { _tag: "NotConnected", onConnect: got("connect") },
				}),
				connectCard(h, {
					provider: "clerk",
					now: NOW,
					status: { _tag: "Syncing", step: "users", done: 40, total: 160 },
				}),
			),
		)
		expect(s.all(tagged("heading")).map(textOf)).toEqual(["Stripe", "Clerk"])
		expect(s.all(tagged("progress")).map((node) => node.props)).toEqual([
			{ style: "inline" },
			{ value: 0.25, label: "Syncing users" },
		])
		const after = s.fire(byProp("button", "label", "Connect"), "press")
		expect(logOf(after)).toEqual(["connect"])
	})

	test("a KPI's delta is coloured by what is good for it", () => {
		expect(deltaLook({ value: 4.1, text: "4.1%" })).toEqual({ trend: "up", tone: "success" })
		expect(deltaLook({ value: 2, text: "2", goodWhen: "down" })).toEqual({ trend: "up", tone: "danger" })
		expect(deltaLook({ value: 0, text: "0%" })).toEqual({ trend: "none", tone: "neutral" })
		const s = draw((h) =>
			h.stack.children(
				kpiTile(h, {
					label: "MRR",
					value: "$48.2k",
					delta: { value: -3, text: "3%" },
					onPress: got("mrr"),
				}),
				noResultsState(h, { onClear: got("clear") }),
			),
		)
		expect(s.get(tagged("statTile")).props).toMatchObject({
			value: "$48.2k",
			trend: "down",
			deltaTone: "danger",
		})
		const after = s.fire(byProp("button", "label", "Clear filters"), "press")
		expect(logOf(after)).toEqual(["clear"])
	})
})

describe("view look", () => {
	test("a view's own look wins; with none set, its key's shipped look, else a muted dot", () => {
		expect(lookOf("paying", { icon: "star", color: null })).toEqual({ icon: "star", color: null })
		expect(lookOf("paying", { icon: null, color: null })).toEqual({ icon: null, color: "green" })
		expect(lookOf("current", null)).toEqual({ icon: null, color: "purple" })
		expect(lookOf("my_customers", null)).toEqual({ icon: "user", color: null })
		expect(lookOf("a-saved-view", null)).toEqual({ icon: null, color: null })
	})

	test("the glyph is the icon in the view's colour, or a dot in it; muted when it has none", () => {
		const s = draw((h) =>
			h.stack.children(
				viewGlyph(h, { icon: "star", color: "blue" }),
				viewGlyph(h, { icon: "user", color: null }),
				viewGlyph(h, { icon: null, color: "purple" }),
				viewGlyph(h, { icon: null, color: null }),
			),
		)
		expect(s.all(tagged("icon")).map((node) => node.props)).toEqual([
			{ name: "star", tint: "blue" },
			{ name: "user", tint: "muted" },
			{ dot: true, tint: "purple" },
			{ dot: true, tint: "muted" },
		])
	})
})
