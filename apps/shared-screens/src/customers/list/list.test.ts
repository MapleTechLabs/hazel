// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Locator, Scene } from "@effect/ui/testing"
import type * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import type { AccountRow, MemberRow } from "../data/queries"
import { listRows, moveColumn, nextSort, sortLabel, sortMenuGroups, toggleColumn } from "./columns"
import { activeFields, chipOf, clearField, matchesFilters, type Viewer } from "./filters"
import { ListControls, ListControlsEvents, type ListControlsProps } from "./ListControls"
import { ListTable, ListTableEvents } from "./ListTable"
import { fittingColumns, type ListTableData } from "./table"

/** The customers list's hazel pieces: filters and sort, the controls (builder, picker) and the table. */

const ADA = Schema.decodeSync(UserId)("00000002-0000-4000-8000-000000000001")
const GRACE = Schema.decodeSync(UserId)("00000002-0000-4000-8000-000000000002")
const id = (n: number) =>
	Schema.decodeSync(CustomerAccountId)(`00000030-0000-4000-8000-${String(n).padStart(12, "0")}`)
const NOW = Date.parse("2026-11-26T15:00:00Z")
const DAY = 86_400_000
const viewer: Viewer = { userId: ADA, nowMs: NOW, isAdmin: false }

const account = (n: number, fields: Partial<AccountRow>): AccountRow => ({
	id: id(n),
	name: `Account ${n}`,
	domain: `account${n}.com`,
	logoUrl: null,
	company: null,
	companyCheckedAtMs: null,
	ownerUserId: null,
	lifecycleStage: "active",
	planName: "Pro",
	mrrMinor: 10_000,
	currency: "USD",
	trialListMrrMinor: null,
	trialEndsAtMs: null,
	seatsUsed: null,
	seatsLimit: null,
	contactCount: 3,
	activeUsers30d: 3,
	activeUsersTrendPct: null,
	openRiskHigh: 0,
	openRiskMedium: 0,
	openRiskLow: 0,
	openOpportunities: 0,
	firstSeenAtMs: NOW - 100 * DAY,
	lastActiveAtMs: NOW - DAY,
	customerSinceMs: NOW - 100 * DAY,
	churnedAtMs: null,
	tags: [],
	featureFlags: {},
	primaryAccountId: null,
	environment: null,
	attentionMutedAtMs: null,
	attentionMutedUntilMs: null,
	attentionMutedByUserId: null,
	...fields,
})

const linear = account(1, {
	name: "Linear",
	domain: "linear.app",
	ownerUserId: ADA,
	mrrMinor: 1_250_000,
	planName: "Enterprise",
	tags: ["strategic"],
})
const linearEu = account(2, {
	name: "Linear",
	domain: "eu.linear.app",
	ownerUserId: ADA,
	mrrMinor: 310_000,
	primaryAccountId: id(1),
	environment: "EU",
})
const acme = account(3, {
	name: "Acme",
	domain: "acme.com",
	ownerUserId: GRACE,
	lifecycleStage: "past_due",
	mrrMinor: 215_000,
	openRiskHigh: 2,
	lastActiveAtMs: NOW - 20 * DAY,
})
const initech = account(4, { name: "Initech", lifecycleStage: "trialing", mrrMinor: 0, planName: null })
const ACCOUNTS = [linear, linearEu, acme, initech]
const MEMBERS: ReadonlyArray<MemberRow> = [
	{ id: ADA, name: "Ada Lovelace", email: "ada@hazel.test", avatarUrl: null },
	{ id: GRACE, name: "Grace Hopper", email: "grace@hazel.test", avatarUrl: null },
]

const tagged = (tag: string) => Locator.tag(`hz:${tag}`)
const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})

describe("customers list: filters, sort and columns", () => {
	test("each filter narrows; Me is the viewer, an inactive window keeps accounts never active", () => {
		const names = (filters: Customers.ViewFilters) =>
			ACCOUNTS.filter((row) => matchesFilters(filters, row, viewer)).map((row) => row.domain)
		expect(names({ ownedByMe: true })).toEqual(["linear.app", "eu.linear.app"])
		expect(names({ unowned: true })).toEqual(["account4.com"])
		expect(names({ payingOnly: true, hasOpenRiskSignals: true })).toEqual(["acme.com"])
		expect(names({ inactiveForDays: 14 })).toEqual(["acme.com"])
		expect(names({ search: "EU" })).toEqual(["eu.linear.app"])
	})

	test("a chip names a field's filters; clearing one leaves the rest", () => {
		const filters: Customers.ViewFilters = {
			lifecycleStages: ["trialing", "active"],
			ownedByMe: true,
			minMrrMinor: 100_000,
		}
		expect(activeFields(filters)).toEqual(["stage", "owner", "mrr"])
		expect(chipOf("stage", filters, MEMBERS, "USD")).toEqual({
			field: "Stage",
			operator: "is any of",
			value: "Trialing, Active",
		})
		expect(chipOf("owner", { ownerUserIds: [GRACE] }, MEMBERS, "USD")?.value).toBe("Grace Hopper")
		expect(chipOf("mrr", filters, MEMBERS, "USD")).toEqual({
			field: "MRR",
			operator: "",
			value: "≥ $1,000",
		})
		expect(clearField(filters, "owner")).toEqual({
			lifecycleStages: ["trialing", "active"],
			minMrrMinor: 100_000,
		})
	})

	test("rows sort, and an environment stays under its primary", () => {
		const rows = listRows(ACCOUNTS, {}, { column: "mrr", direction: "desc" }, MEMBERS, viewer)
		expect(rows.map((row) => row.domain)).toEqual([
			"linear.app",
			"eu.linear.app",
			"acme.com",
			"account4.com",
		])
		expect(nextSort({ column: "mrr", direction: "desc" }, "mrr")).toEqual({
			column: "mrr",
			direction: "asc",
		})
		expect(nextSort({ column: "mrr", direction: "desc" }, "name")).toEqual({
			column: "name",
			direction: "asc",
		})
		expect(sortLabel({ column: "mrr", direction: "desc" })).toBe("MRR, high to low")
		const [entries] = sortMenuGroups({ column: "name", direction: "asc" })
		expect(entries?.entries.find((entry) => entry.checked)?.label).toBe("Name A–Z")
	})

	test("the picker keeps the name first and moves the others one place", () => {
		expect(toggleColumn(["mrr"], "name", false)).toEqual(["name", "mrr"])
		expect(toggleColumn(["name", "mrr"], "tags", true)).toEqual(["name", "mrr", "tags"])
		expect(moveColumn(["name", "owner", "mrr"], "mrr", -1)).toEqual(["name", "mrr", "owner"])
		expect(moveColumn(["name", "owner", "mrr"], "owner", -1)).toEqual(["name", "owner", "mrr"])
	})

	test("columns drop by the table's width as today's container queries; unknown keeps them all", () => {
		const columns: ReadonlyArray<Customers.ListColumn> = [
			"name",
			"owner",
			"stage",
			"plan",
			"mrr",
			"last_active",
		]
		expect(fittingColumns(columns, 830)).toEqual(["name", "stage", "plan", "mrr"])
		expect(fittingColumns(columns, 390)).toEqual(["name", "mrr"])
		expect(fittingColumns(columns, null)).toEqual(columns)
	})
})

const controlsProps = (overrides: Partial<ListControlsProps> = {}): ListControlsProps => ({
	accounts: ACCOUNTS,
	members: MEMBERS,
	filters: { lifecycleStages: ["trialing", "active", "past_due"] },
	search: "",
	sort: { column: "mrr", direction: "desc" },
	columns: ["name", "owner", "mrr"],
	count: 4,
	currency: "USD",
	userId: ADA,
	nowMs: NOW,
	compact: false,
	...overrides,
})

describe("customers list: controls", () => {
	test("search, a chip's remove and the sort menu ask the page", () => {
		Scene.start(ListControls, controlsProps())
			.fire(tagged("searchField"), "change", { value: "acme", rev: 1, edit: 0 })
			.emitted(ListControlsEvents.ChangedSearch({ value: "acme" }))
			.fire(byProp("button", "detail", "Stage is any of"), "remove")
			.emitted(ListControlsEvents.ClearedFilter({ field: "stage" }))
			.fire(byProp("menu", "label", "Sort"), "select", { id: "name:asc" })
			.emitted(ListControlsEvents.ChangedSort({ sort: { column: "name", direction: "asc" } }))
	})

	test("the builder opens on the first active field, edits a copy and applies it", () => {
		const s = Scene.start(ListControls, controlsProps()).fire(
			byProp("button", "label", "Filter"),
			"press",
		)
		expect(s.get(byProp("popover", "key", "filter")).props?.["open"]).toBe(true)
		expect(s.get(byProp("item", "title", "Stage")).props?.["selected"]).toBe(true)
		s.fire(byProp("choiceGroup", "label", "Stage"), "change", { selected: ["active"] })
			.fire(byProp("item", "title", "MRR"), "press")
			.fire(byProp("textField", "label", "At least ($)"), "change", { value: "500", rev: 1, edit: 1 })
			.fire(byProp("button", "label", "Apply filter"), "press")
			.emitted(
				ListControlsEvents.AppliedFilters({
					filters: { lifecycleStages: ["active"], minMrrMinor: 50_000 },
				}),
			)
		expect(s.get(byProp("popover", "key", "filter")).props?.["open"]).toBeUndefined()
	})

	test("a chip opens the builder on its field; Cancel drops the edit", () => {
		const s = Scene.start(ListControls, controlsProps({ filters: { lastActiveWithinDays: 7 } }))
			.fire(byProp("button", "detail", "Last active within"), "press")
			.fire(byProp("button", "label", "30d"), "press")
		expect(s.get(byProp("textField", "label", "Days")).props?.["value"]).toMatchObject({ text: "30" })
		s.fire(byProp("button", "label", "Cancel"), "press")
		expect(s.get(byProp("popover", "key", "filter")).props?.["open"]).toBeUndefined()
	})

	test("a phone's builder offers the fields as chips", () => {
		const s = Scene.start(ListControls, controlsProps({ compact: true })).fire(
			byProp("button", "label", "Filter"),
			"press",
		)
		s.fire(byProp("choiceGroup", "label", "Filter by"), "change", { selected: ["owner"] })
		expect(s.get(byProp("choiceGroup", "label", "Owner")).props?.["options"]).toHaveLength(3)
	})

	test("the picker toggles, moves and resets the view's columns", () => {
		Scene.start(ListControls, controlsProps())
			.fire(byProp("button", "label", "Columns"), "press")
			.fire(byProp("toggle", "label", "Tags"), "change", { checked: true })
			.emitted(ListControlsEvents.ChangedColumns({ columns: ["name", "owner", "mrr", "tags"] }))
			.fire(byProp("button", "label", "Move MRR up"), "press")
			.emitted(ListControlsEvents.ChangedColumns({ columns: ["name", "mrr", "owner"] }))
			.fire(byProp("button", "label", "Reset"), "press")
			.emitted(ListControlsEvents.ResetColumns())
	})
})

const tableProps = (overrides: Partial<ListTableData> = {}): ListTableData => ({
	accounts: listRows(ACCOUNTS, {}, { column: "mrr", direction: "desc" }, MEMBERS, viewer),
	loading: false,
	rowLimit: 200,
	columns: ["name", "owner", "stage", "mrr"],
	sort: { column: "mrr", direction: "desc" },
	selected: [],
	focusedId: null,
	currency: "USD",
	nowMs: NOW,
	members: MEMBERS,
	sparklines: {},
	width: null,
	...overrides,
})

describe("customers list: table", () => {
	test("a row per account, the cursor and selection marked, the totals under them", () => {
		const s = Scene.start(ListTable, tableProps({ selected: [acme.id], focusedId: linear.id }))
		expect(s.all(tagged("tableRow")).map((row) => row.props?.["title"])).toEqual([
			"Linear",
			"Linear (EU)",
			"Acme",
			"Initech",
			undefined,
		])
		expect(s.get(byProp("tableRow", "key", acme.id)).props?.["selected"]).toBe(true)
		expect(s.get(byProp("tableRow", "key", linear.id)).props?.["current"]).toBe(true)
		expect(s.get(byProp("tableRow", "key", "footer")).props?.["footer"]).toBe(true)
		s.expect(Locator.text("4 customers")).toExist()
		s.expect(Locator.text("$17,750")).toExist()
	})

	test("presses ask the page: sort, a row, its checkbox and the header's", () => {
		Scene.start(ListTable, tableProps())
			.fire(tagged("table"), "sort", { column: "name" })
			.emitted(ListTableEvents.ClickedSortHeader({ column: "name" }))
			.fire(byProp("tableRow", "key", acme.id), "press")
			.emitted(ListTableEvents.PressedRow({ accountId: acme.id }))
			.fire(byProp("tableRow", "key", acme.id), "select", { selected: true })
			.emitted(ListTableEvents.ToggledRow({ accountId: acme.id, selected: true }))
			.fire(tagged("table"), "selectAll", { selected: true })
			.emitted(ListTableEvents.ToggledAllRows({ selected: true }))
	})

	test("columns drop by the measured width; past the row limit, Show more", () => {
		const s = Scene.start(ListTable, tableProps({ width: 700, rowLimit: 2 }))
		const columns = s.get(tagged("table")).props?.["columns"] as ReadonlyArray<{ key: string }>
		expect(columns.map((column) => column.key)).toEqual(["name", "stage", "mrr"])
		s.expect(Locator.text("Showing 2 of 4")).toExist()
		s.fire(byProp("button", "label", "Show 2 more"), "press").emitted(ListTableEvents.PressedShowMore())
	})

	test("loading draws skeleton rows and no totals", () => {
		const s = Scene.start(ListTable, tableProps({ loading: true, accounts: [] }))
		expect(s.get(tagged("table")).props).toMatchObject({ loading: true, loadingRows: 12 })
		expect(s.all(byProp("tableRow", "key", "footer"))).toHaveLength(0)
	})
})
