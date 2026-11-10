import { CustomerAccountId, CustomerSavedViewId, OrganizationId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { describe, expect, test, vi } from "vitest"
import type { AccountRow } from "../../../customers/queries"
import { AppRoute } from "../../../route"
import * as Menu from "../../../ui/menu"
import type { Shared } from "../../contract"
import { sharedDefaults } from "../../test-shared"
import { Message } from "./message"
import {
	bestFilterToRemove,
	isEdited,
	matchesFilters,
	type Model,
	moveColumn,
	nextSort,
	ownerEntries,
	toggleColumn,
	type ViewRow,
	visibleAccounts,
} from "./model"
import { listKeyOf } from "./subscription"
import { toCsv } from "./table"
import { init, routeChanged, update, viewerOf } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for the customers list: views, filters, sort, columns, selection and bulk actions. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const ada = Schema.decodeSync(UserId)(uuid(1))
const grace = Schema.decodeSync(UserId)(uuid(2))
const organizationId = Schema.decodeSync(OrganizationId)(uuid(3))
const accountId = Schema.decodeSync(CustomerAccountId)
const NOW = Date.UTC(2026, 10, 10, 12)
const DAY = 86_400_000

const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: ada,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: null,
	nowMs: NOW,
	...sharedDefaults,
}
const viewer = viewerOf(shared)

const account = (n: number, name: string, fields: Partial<AccountRow> = {}): AccountRow => ({
	id: accountId(uuid(100 + n)),
	name,
	domain: `${name.toLowerCase().replace(/\s/g, "")}.io`,
	logoUrl: null,
	ownerUserId: ada,
	lifecycleStage: "active",
	planName: "Growth",
	mrrMinor: 10_000,
	currency: "USD",
	trialListMrrMinor: null,
	trialEndsAtMs: null,
	healthScore: 80,
	healthStatus: "healthy",
	seatsUsed: null,
	seatsLimit: null,
	contactCount: 10,
	activeUsers30d: 5,
	activeUsersTrendPct: 0,
	openRiskHigh: 0,
	openRiskMedium: 0,
	openRiskLow: 0,
	openOpportunities: 0,
	firstSeenAtMs: NOW - 400 * DAY,
	lastActiveAtMs: NOW - DAY,
	customerSinceMs: NOW - 300 * DAY,
	churnedAtMs: null,
	tags: [],
	...fields,
})

const acme = account(1, "Acme Robotics", {
	mrrMinor: 215_000,
	healthStatus: "at_risk",
	healthScore: 54,
	openRiskHigh: 1,
	planName: "Scale",
})
const brightfield = account(2, "Brightfield", {
	ownerUserId: grace,
	mrrMinor: 0,
	lifecycleStage: "trialing",
	planName: null,
})
const kestrel = account(3, "Kestrel Systems", {
	mrrMinor: 132_000,
	healthStatus: "critical",
	healthScore: 27,
	lastActiveAtMs: NOW - 20 * DAY,
	tags: ["enterprise"],
})
const northwind = account(4, "Northwind Labs", { ownerUserId: null, mrrMinor: 480_000, planName: "Scale" })
const accounts = [acme, brightfield, kestrel, northwind]

const atRisk: ViewRow = {
	id: Schema.decodeSync(CustomerSavedViewId)(uuid(40)),
	name: "At risk",
	builtInKey: "at_risk",
	ownerUserId: null,
	position: 3,
	filters: { healthStatuses: ["at_risk", "critical"] },
	sort: { column: "mrr", direction: "desc" },
	columns: ["name", "owner", "mrr", "health"],
}
const mine: ViewRow = {
	...atRisk,
	id: Schema.decodeSync(CustomerSavedViewId)(uuid(41)),
	name: "Scale accounts",
	builtInKey: null,
	ownerUserId: ada,
	position: 5,
	filters: { planNames: ["Scale"] },
	sort: { column: "name", direction: "asc" },
}

const route = (view: string | null) =>
	AppRoute.CustomersList({ orgSlug: "hazel", view: Option.fromNullishOr(view) })
const run = (model: Model, messages: ReadonlyArray<Message>) =>
	messages.reduce((current, message) => update(current, message, shared).model, model)
const loaded = (view: string | null = null): Model =>
	run(init(route(view)).model, [
		Message.UpdatedViews({ views: [atRisk, mine] }),
		Message.UpdatedAccounts({ accounts }),
	])
const names = (model: Model) => visibleAccounts(model, viewer).map((row) => row.name)
/** Opens a menu, then picks `key` (a closed menu ignores clicks). */
const pick = (
	model: Model,
	wrap: (message: Menu.Message) => Message,
	key: string,
	entries: ReadonlyArray<Menu.Entry>,
) =>
	update(
		run(model, [wrap(Menu.Message.PressedTrigger({ pointerType: "mouse" }))]),
		wrap(Menu.Message.ClickedItem({ key, entries })),
		shared,
	)
const commandNames = (result: ReturnType<typeof update>) =>
	(result.commands ?? []).map((command) => command.name)

describe("customers list: filters and views", () => {
	test("All customers lists every account by name", () => {
		expect(names(loaded())).toEqual(["Acme Robotics", "Brightfield", "Kestrel Systems", "Northwind Labs"])
	})

	test("a built-in view applies its filters and sort, before and after the views sync", () => {
		expect(names(run(init(route("at_risk")).model, [Message.UpdatedAccounts({ accounts })]))).toEqual([
			"Acme Robotics",
			"Kestrel Systems",
		])
		expect(names(loaded("at_risk"))).toEqual(["Acme Robotics", "Kestrel Systems"])
	})

	test("each filter narrows", () => {
		const matches = (filters: Parameters<typeof matchesFilters>[0]) =>
			accounts.filter((row) => matchesFilters(filters, row, viewer)).map((row) => row.name)
		expect(matches({ ownedByMe: true })).toEqual(["Acme Robotics", "Kestrel Systems"])
		expect(matches({ unowned: true, ownerUserIds: [grace] })).toEqual(["Brightfield", "Northwind Labs"])
		expect(matches({ payingOnly: true, maxMrrMinor: 200_000 })).toEqual(["Kestrel Systems"])
		expect(matches({ inactiveForDays: 14 })).toEqual(["Kestrel Systems"])
		expect(matches({ lastActiveWithinDays: 7, hasOpenRiskSignals: false })).toEqual([
			"Brightfield",
			"Northwind Labs",
		])
		expect(matches({ tagsAny: ["enterprise"] })).toEqual(["Kestrel Systems"])
		expect(matches({ search: "north" })).toEqual(["Northwind Labs"])
	})

	test("the filter builder applies its pending filters; a chip removes one field", () => {
		const applied = run(loaded(), [
			Message.PressedEditFilter({ field: "plan" }),
			Message.ChangedPendingFilters({ filters: { planNames: ["Scale"], lifecycleStages: ["active"] } }),
			Message.AppliedFilter(),
		])
		expect(applied.builder).toBeNull()
		expect(names(applied)).toEqual(["Acme Robotics", "Northwind Labs"])
		expect(isEdited(applied)).toBe(true)
		const cleared = run(applied, [Message.ClearedFilter({ field: "plan" })])
		expect(cleared.draft.filters).toEqual({ lifecycleStages: ["active"] })
	})

	test("no results suggests the filter whose removal shows the most", () => {
		const model = {
			...loaded(),
			draft: { ...loaded().draft, filters: { planNames: ["Scale"], inactiveForDays: 14 } },
		}
		expect(names(model)).toEqual([])
		expect(bestFilterToRemove(model, viewer)).toEqual({ field: "last_active", count: 2 })
	})

	test("switching views loads the view and drops the selection", () => {
		const selected = run(loaded(), [Message.ToggledRow({ accountId: acme.id, isSelected: true })])
		const next = routeChanged(selected, route(mine.id)).model
		expect(next.selected).toEqual([])
		expect(names(next)).toEqual(["Acme Robotics", "Northwind Labs"])
		expect(isEdited(next)).toBe(false)
	})

	test("an unedited draft follows its view when it changes; an edited one stays", () => {
		const changed = { ...mine, filters: { planNames: ["Growth"] } }
		const following = run(loaded(mine.id), [Message.UpdatedViews({ views: [atRisk, changed] })])
		expect(following.draft.filters).toEqual({ planNames: ["Growth"] })
		const edited = run(loaded(mine.id), [
			Message.ClickedSortHeader({ column: "mrr" }),
			Message.UpdatedViews({ views: [atRisk, changed] }),
		])
		expect(edited.draft.filters).toEqual({ planNames: ["Scale"] })
	})
})

describe("customers list: sort and columns", () => {
	test("a header press sorts; pressing again flips", () => {
		const byMrr = run(loaded(), [Message.ClickedSortHeader({ column: "mrr" })])
		expect(names(byMrr)).toEqual(["Northwind Labs", "Acme Robotics", "Kestrel Systems", "Brightfield"])
		expect(names(run(byMrr, [Message.ClickedSortHeader({ column: "mrr" })]))[0]).toBe("Brightfield")
		expect(nextSort({ column: "mrr", direction: "desc" }, "name")).toEqual({
			column: "name",
			direction: "asc",
		})
	})

	test("health sorts unscored accounts last either way", () => {
		const unknown = account(5, "Zeta", { healthStatus: "unknown", healthScore: null })
		const model = run(loaded(), [Message.UpdatedAccounts({ accounts: [...accounts, unknown] })])
		const ascending = run(model, [
			Message.ClickedSortHeader({ column: "health" }),
			Message.ClickedSortHeader({ column: "health" }),
		])
		expect(names(ascending).at(-1)).toBe("Zeta")
		expect(names(run(model, [Message.ClickedSortHeader({ column: "health" })])).at(-1)).toBe("Zeta")
	})

	test("columns toggle and reorder; the name column stays first", () => {
		const columns = ["name", "owner", "mrr"] as const
		expect(toggleColumn(columns, "tags", true)).toEqual(["name", "owner", "mrr", "tags"])
		expect(toggleColumn(columns, "owner", false)).toEqual(["name", "mrr"])
		expect(toggleColumn(columns, "name", false)).toEqual(["name", "owner", "mrr"])
		expect(moveColumn(columns, "mrr", -1)).toEqual(["name", "mrr", "owner"])
		expect(moveColumn(columns, "owner", -1)).toEqual(["name", "owner", "mrr"])
	})
})

describe("customers list: saving views", () => {
	test("Save view creates a personal view from the draft, then opens it", () => {
		const edited = run(loaded(), [
			Message.ClickedSortHeader({ column: "mrr" }),
			Message.PressedSaveView(),
		])
		expect(edited.saveModal.isOpen).toBe(true)
		const named = run(edited, [Message.ChangedSaveName({ value: "  Biggest first " })])
		const saved = update(named, Message.SubmittedSave(), shared)
		expect(commandNames(saved)).toEqual(["CreateSavedView"])
		expect(saved.commands?.[0]?.args).toMatchObject({
			isShared: false,
			position: 6,
			view: { name: "Biggest first", sort: { column: "mrr", direction: "desc" }, filters: {} },
		})
		expect(saved.model.saveForm).toBeNull()
		const done = update(
			saved.model,
			Message.SucceededViewAction({ action: "create", viewId: mine.id }),
			shared,
		)
		expect(done.outMessage?._tag).toBe("RequestedNavigation")
	})

	test("Save changes updates the current view; deleting goes back to All", () => {
		const edited = run(loaded(mine.id), [Message.ClickedSortHeader({ column: "mrr" })])
		const entries = [Menu.item("save"), Menu.item("delete")]
		const toViewMenu = (message: Menu.Message) => Message.GotViewMenuMessage({ message })
		const saved = pick(edited, toViewMenu, "save", entries)
		expect(commandNames(saved)).toContain("UpdateSavedView")
		const deleted = pick(edited, toViewMenu, "delete", entries)
		expect(commandNames(deleted)).toContain("DeleteSavedView")
		expect(deleted.outMessage?._tag).toBe("RequestedNavigation")
	})
})

describe("customers list: selection and bulk actions", () => {
	test("select all takes the visible rows only", () => {
		const selected = run(loaded("at_risk"), [Message.ToggledAllRows({ isSelected: true })])
		expect(selected.selected).toEqual([acme.id, kestrel.id])
		expect(run(selected, [Message.ClearedSelection()]).selected).toEqual([])
	})

	test("assigning an owner updates the rows at once and runs the bulk update", () => {
		const selected = run(loaded(), [
			Message.ToggledRow({ accountId: acme.id, isSelected: true }),
			Message.ToggledRow({ accountId: northwind.id, isSelected: true }),
		])
		const entries = ownerEntries(
			[{ id: grace, name: "Grace Hopper", email: "grace@hazel.test", avatarUrl: null }],
			viewer,
		)
		const withMembers = run(selected, [
			Message.UpdatedMembers({
				members: [{ id: grace, name: "Grace Hopper", email: "grace@hazel.test", avatarUrl: null }],
			}),
		])
		const result = pick(
			withMembers,
			(message) => Message.GotOwnerMenuMessage({ message }),
			`user:${grace}`,
			entries,
		)
		expect(commandNames(result)).toContain("BulkAssignOwner")
		expect(
			result.model.accounts?.filter((row) => row.ownerUserId === grace).map((row) => row.name),
		).toEqual(["Acme Robotics", "Brightfield", "Northwind Labs"])
	})

	test("adding a tag tags every selected account once", () => {
		const selected = run(loaded(), [
			Message.ToggledRow({ accountId: kestrel.id, isSelected: true }),
			Message.ToggledRow({ accountId: acme.id, isSelected: true }),
		])
		const result = update(selected, Message.SubmittedTag({ tag: " enterprise " }), shared)
		expect(commandNames(result)).toContain("BulkAddTag")
		expect(result.model.accounts?.find((row) => row.id === kestrel.id)?.tags).toEqual(["enterprise"])
		expect(result.model.accounts?.find((row) => row.id === acme.id)?.tags).toEqual(["enterprise"])
	})

	test("a failed bulk update says so (the synced rows roll back on their own)", () => {
		const failed = update(
			loaded(),
			Message.FailedBulkUpdate({ action: "owner", reason: "Offline", isBatched: false }),
			shared,
		)
		expect(failed.outMessage?._tag).toBe("RequestedToast")
	})

	test("the toast counts what the server updated", () => {
		const done = update(
			loaded(),
			Message.SucceededBulkUpdate({ action: "tag", count: 500, label: "vip" }),
			shared,
		)
		expect(JSON.stringify(done.outMessage)).toContain("Tagged 500 customers")
	})

	test("a search or filter keeps only the selected rows it still shows", () => {
		const selected = run(loaded(), [Message.ToggledAllRows({ isSelected: true })])
		expect(run(selected, [Message.ChangedSearch({ value: "acme" })]).selected).toEqual([acme.id])
		const scale = run(selected, [Message.ChangedPendingFilters({ filters: { planNames: ["Scale"] } })])
		expect(scale.selected).toHaveLength(4)
		expect(
			run(selected, [
				Message.PressedEditFilter({ field: "plan" }),
				Message.ChangedPendingFilters({ filters: { planNames: ["Scale"] } }),
				Message.AppliedFilter(),
			]).selected,
		).toEqual([acme.id, northwind.id])
		// A sort shows the same rows.
		expect(run(selected, [Message.ClickedSortHeader({ column: "mrr" })]).selected).toHaveLength(4)
	})
})

describe("customers list: many accounts", () => {
	const many = Array.from({ length: 450 }, (_, index) => account(1000 + index, `Account ${index}`))

	test("renders a page of rows at a time; j past the last one renders the next", () => {
		const model = run(init(route(null)).model, [Message.UpdatedAccounts({ accounts: many })])
		expect(model.rowLimit).toBe(200)
		expect(run(model, [Message.PressedShowMoreRows()]).rowLimit).toBe(400)
		const walked = run(
			model,
			Array.from({ length: 201 }, () => Message.PressedListKey({ key: "next" })),
		)
		expect(walked.rowLimit).toBe(400)
		expect(run(walked, [Message.ChangedSearch({ value: "Account" })]).rowLimit).toBe(200)
	})

	test("sparklines are asked for the rendered rows only", () => {
		const first = update(init(route(null)).model, Message.UpdatedAccounts({ accounts: many }), shared)
		expect(first.model.requestedSparklines).toHaveLength(200)
		const more = update(first.model, Message.PressedShowMoreRows(), shared)
		expect(commandNames(more)).toEqual(["FetchListSparklines"])
	})
})

describe("customers list: CSV", () => {
	test("a cell a spreadsheet would run as a formula is escaped", () => {
		const csv = toCsv(
			[{ ...acme, name: "=HYPERLINK(1)", domain: "@evil", tags: ["+x", "a\rb"] }],
			["name", "tags", "mrr"],
			{ membersById: new Map(), nowMs: NOW },
		)
		expect(csv.split("\n")[1]).toBe(`'=HYPERLINK(1),'@evil,"'+x; a\rb",2150.00`)
		expect(
			toCsv([{ ...acme, mrrMinor: -500 }], ["mrr"], { membersById: new Map(), nowMs: NOW }),
		).toContain("-5.00")
	})
})

describe("customers list: keyboard and hover", () => {
	test("j/k move the cursor, x selects, Enter opens", () => {
		const first = run(loaded(), [
			Message.PressedListKey({ key: "next" }),
			Message.PressedListKey({ key: "next" }),
		])
		expect(first.focusedId).toBe(brightfield.id)
		expect(run(first, [Message.PressedListKey({ key: "previous" })]).focusedId).toBe(acme.id)
		expect(run(first, [Message.PressedListKey({ key: "select" })]).selected).toEqual([brightfield.id])
		expect(update(first, Message.PressedListKey({ key: "open" }), shared).outMessage?._tag).toBe(
			"RequestedNavigation",
		)
	})

	test("typing never reaches the list keys", () => {
		const base = { altKey: false, ctrlKey: false, metaKey: false, target: null }
		expect(listKeyOf({ ...base, key: "j" })).toBe("next")
		expect(listKeyOf({ ...base, key: "j", metaKey: true })).toBeNull()
		expect(listKeyOf({ ...base, key: "q" })).toBeNull()
	})

	test("the hover card waits, then shows; moving between rows switches at once", () => {
		const waiting = update(loaded(), Message.HoveredRow({ accountId: acme.id }), shared)
		expect(commandNames(waiting)).toEqual(["WaitBeforeHoverCard"])
		const shown = run(waiting.model, [Message.ElapsedHoverDelay({ accountId: acme.id })])
		expect(shown.hoveredId).toBe(acme.id)
		expect(run(shown, [Message.HoveredRow({ accountId: kestrel.id })]).hoveredId).toBe(kestrel.id)
		expect(run(shown, [Message.UnhoveredRow()]).hoveredId).toBeNull()
		expect(
			run(waiting.model, [Message.UnhoveredRow(), Message.ElapsedHoverDelay({ accountId: acme.id })])
				.hoveredId,
		).toBeNull()
	})

	test("sparklines are asked for once per account", () => {
		const first = update(init(route(null)).model, Message.UpdatedAccounts({ accounts }), shared)
		expect(commandNames(first)).toEqual(["FetchListSparklines"])
		expect(commandNames(update(first.model, Message.UpdatedAccounts({ accounts }), shared))).toEqual([])
	})
})
