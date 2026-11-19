import type * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import { describe, expect, test, vi } from "vitest"
import { toAccountRow } from "../../../../customers/queries"
import { ACCOUNTS } from "../../../../lab/fixtures/customers"
import {
	LAYOUTS,
	METRIC_DEFS,
	OBSERVABILITY,
	SELF_SERVE,
	TRIAL_ONBOARDING,
} from "../../../../lab/fixtures/customers-overview"
import { AppRoute } from "../../../../route"
import { makeShared, memberWithRole } from "../../../../test/pages-fixtures"
import { Message } from "./message"
import { draftOrder, isDirty, listOrder, type Model } from "./model"
import { init, type LayoutsRoute, routeChanged, update } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for Overview layouts: the list's order, the new layout dialog, the editor, the dry run. */

const shared = makeShared({ member: memberWithRole("admin"), nowMs: Date.UTC(2026, 10, 10, 12) })

type Result = ReturnType<typeof update>
const run = (model: Model, messages: ReadonlyArray<Message>) =>
	messages.reduce((current, next) => update(current, next, shared).model, model)
const names = (result: Pick<Result, "commands">) => (result.commands ?? []).map((command) => command.name)

const listRoute: LayoutsRoute = AppRoute.CustomersSettingsLayouts({ orgSlug: "hazel" })
const newRoute = (from: string): LayoutsRoute =>
	AppRoute.CustomersSettingsLayoutNew({
		orgSlug: "hazel",
		from: Option.some(from),
		name: Option.some("Enterprise expansion"),
		preview: Option.none(),
	})
const editRoute = (layout: (typeof LAYOUTS)[number]): LayoutsRoute =>
	AppRoute.CustomersSettingsLayout({ orgSlug: "hazel", layoutId: layout.id, preview: Option.none() })

const synced = (route: LayoutsRoute): Model =>
	run(init(route, shared).model, [
		Message.UpdatedMetrics({ metrics: METRIC_DEFS }),
		Message.UpdatedAccounts({ accounts: ACCOUNTS.slice(0, 5).map(toAccountRow) }),
		Message.UpdatedLayouts({ layouts: LAYOUTS }),
	])

const result: Customers.LayoutDryRunResult = {
	matchingCount: 9,
	matching: [],
	takenBy: [{ layoutId: OBSERVABILITY.id, name: "Observability", count: 4 }],
	pinnedElsewhere: 0,
	effectiveCount: 5,
}

describe("layouts: the list", () => {
	test("rules are tried in position order, the default last", () => {
		expect(listOrder(synced(listRoute)).map((layout) => layout.name)).toEqual([
			"Observability",
			"Trial onboarding",
			"Self-serve",
			"Default",
		])
	})

	test("moving a layout shows the new order at once and saves it", () => {
		const moved = update(
			synced(listRoute),
			Message.PressedMoveLayout({ layoutId: SELF_SERVE.id, step: -1 }),
			shared,
		)
		expect(names(moved)).toEqual(["ReorderOverviewLayouts"])
		expect(moved.commands?.[0]?.args).toMatchObject({
			layoutIds: [OBSERVABILITY.id, SELF_SERVE.id, TRIAL_ONBOARDING.id],
		})
		expect(listOrder(moved.model).map((layout) => layout.name)).toEqual([
			"Observability",
			"Self-serve",
			"Trial onboarding",
			"Default",
		])
		expect(listOrder(run(moved.model, [Message.SucceededReorderLayouts()])).at(-1)?.isDefault).toBe(true)
	})

	test("Create and edit opens the editor for the picked start, saving nothing yet", () => {
		const filled = run(synced(listRoute), [
			Message.PressedNewLayout(),
			Message.ChangedNewName({ value: "  Enterprise expansion " }),
			Message.ClickedNewFrom({ from: "observability" }),
		])
		const created = update(filled, Message.PressedCreateAndEdit(), shared)
		expect(names(created)).toEqual([])
		expect(created.outMessage).toMatchObject({
			_tag: "RequestedNavigation",
			route: newRoute("observability"),
		})
	})
})

describe("layouts: the editor", () => {
	test("a new layout starts from its starter, unsaved, and creates on save", () => {
		const opened = synced(newRoute("observability"))
		expect(opened.editor?.draft?.name).toBe("Enterprise expansion")
		expect(opened.editor?.draft?.widgets.length).toBe(8)
		expect(isDirty(opened.editor!)).toBe(true)
		const saving = update(opened, Message.PressedSave(), shared)
		expect(names(saving)).toEqual(["CreateOverviewLayout"])
		const saved = update(saving.model, Message.SucceededCreateLayout(), shared)
		expect(saved.outMessage).toMatchObject({ _tag: "RequestedNavigation", route: listRoute })
	})

	test("a copy waits for the layouts, then takes the copied layout's widgets and rule", () => {
		const opened = init(newRoute(OBSERVABILITY.id), shared).model
		expect(opened.editor?.draft).toBeNull()
		const copied = run(opened, [Message.UpdatedLayouts({ layouts: LAYOUTS })])
		expect(copied.editor?.draft).toMatchObject({ name: "Enterprise expansion", rule: OBSERVABILITY.rule })
	})

	test("an existing layout opens unchanged; a rule edit reruns the dry run after a pause", () => {
		const opened = synced(editRoute(SELF_SERVE))
		expect(isDirty(opened.editor!)).toBe(false)
		const edited = update(
			opened,
			Message.EditedRule({
				rule: { match: "any", conditions: [{ _tag: "stage", stages: ["trialing"] }] },
			}),
			shared,
		)
		expect(names(edited)).toEqual(["WaitForLayoutDryRunDelay"])
		const version = edited.model.editor!.version
		expect(
			names(update(edited.model, Message.ElapsedLayoutDryRunDelay({ version: version - 1 }), shared)),
		).toEqual([])
		const fetched = update(edited.model, Message.ElapsedLayoutDryRunDelay({ version }), shared)
		expect(names(fetched)).toEqual(["FetchLayoutDryRun"])
		const stale = run(fetched.model, [
			Message.SucceededFetchLayoutDryRun({ version: version - 1, result }),
		])
		expect(stale.editor?.dryRun._tag).not.toBe("Success")
	})

	test("Move above puts the layout before the one that keeps its customers, and save reorders", () => {
		const opened = synced(editRoute(SELF_SERVE))
		const moved = run(opened, [
			Message.SucceededFetchLayoutDryRun({ version: opened.editor!.version, result }),
			Message.PressedMoveAbove({ layoutId: OBSERVABILITY.id }),
		])
		expect(draftOrder(moved, moved.editor!)).toEqual([
			SELF_SERVE.id,
			OBSERVABILITY.id,
			TRIAL_ONBOARDING.id,
		])
		const saving = update(moved, Message.PressedSave(), shared)
		expect(names(saving)).toContain("UpdateOverviewLayout")
		expect(names(saving)).not.toContain("ReorderOverviewLayouts")
		const updated = update(
			saving.model,
			Message.SucceededUpdateLayout({ layoutId: SELF_SERVE.id }),
			shared,
		)
		expect(
			updated.commands?.find((command) => command.name === "ReorderOverviewLayouts")?.args,
		).toMatchObject({ layoutIds: [SELF_SERVE.id, OBSERVABILITY.id, TRIAL_ONBOARDING.id] })
		expect(updated.model.editor?.before).toBe(OBSERVABILITY.id)
		expect(run(updated.model, [Message.SucceededReorderLayouts()]).editor?.before).toBeNull()
	})

	test("a save marks saved what it sent, not edits made while it ran", () => {
		const opened = synced(editRoute(SELF_SERVE))
		const saving = run(opened, [
			Message.ChangedName({ value: "Self-serve teams" }),
			Message.PressedSave(),
		])
		const landed = run(saving, [
			Message.ChangedName({ value: "Self-serve teams (EU)" }),
			Message.SucceededUpdateLayout({ layoutId: SELF_SERVE.id }),
		])
		expect(landed.editor?.saved?.name).toBe("Self-serve teams")
		expect(isDirty(landed.editor!)).toBe(true)
	})

	test("a member sees the layout read-only: no dry run, no save, no selection", () => {
		const member = makeShared({ member: memberWithRole("member"), nowMs: shared.nowMs })
		const opened = init(editRoute(SELF_SERVE), member)
		const synced = [
			Message.UpdatedMetrics({ metrics: METRIC_DEFS }),
			Message.UpdatedLayouts({ layouts: LAYOUTS }),
		].reduce<Result>((current, next) => {
			const step = update(current.model, next, member)
			return { ...step, commands: [...(current.commands ?? []), ...(step.commands ?? [])] }
		}, opened)
		expect(names(synced)).not.toContain("FetchLayoutDryRun")
		const edited = update(synced.model, Message.ChangedName({ value: "Mine" }), member).model
		expect(names(update(edited, Message.PressedSave(), member))).toEqual([])
		expect(
			update(edited, Message.ClickedWidget({ widgetId: "mrr" }), member).model.editor?.selectedId,
		).toBeNull()
	})

	test("one reorder at a time", () => {
		const moving = update(
			synced(listRoute),
			Message.PressedMoveLayout({ layoutId: SELF_SERVE.id, step: -1 }),
			shared,
		)
		expect(
			names(
				update(
					moving.model,
					Message.PressedMoveLayout({ layoutId: SELF_SERVE.id, step: -1 }),
					shared,
				),
			),
		).not.toContain("ReorderOverviewLayouts")
	})

	test("widgets add selected, duplicate under a fresh id, and remove", () => {
		const opened = synced(newRoute("blank"))
		const added = run(opened, [Message.PressedAddWidget({ kind: "chart" })])
		expect(added.editor?.draft?.widgets.map((widget) => widget.id)).toEqual(["chart-1"])
		expect(added.editor?.selectedId).toBe("chart-1")
		const copied = run(added, [Message.PressedDuplicateWidget()])
		expect(copied.editor?.draft?.widgets.map((widget) => widget.id)).toEqual(["chart-1", "chart-2"])
		const removed = run(copied, [Message.PressedRemoveWidget()])
		expect(removed.editor?.draft?.widgets.map((widget) => widget.id)).toEqual(["chart-1"])
		expect(removed.editor?.selectedId).toBeNull()
	})

	test("the metric picker adds to a chart and never leaves it empty", () => {
		const chart = run(synced(newRoute("blank")), [Message.PressedAddWidget({ kind: "chart" })])
		const keysOf = (model: Model) => {
			const widget = model.editor?.draft?.widgets[0]
			return widget?._tag === "chart" ? widget.metricKeys : []
		}
		const added = run(chart, [Message.PickedMetric({ metricKey: "mcp_tool_calls" })])
		expect(keysOf(added)).toEqual(["active_users", "mcp_tool_calls"])
		const emptied = run(added, [
			Message.PickedMetric({ metricKey: "mcp_tool_calls" }),
			Message.PickedMetric({ metricKey: "active_users" }),
		])
		expect(keysOf(emptied)).toEqual(["active_users"])
	})

	test("leaving for the list drops the editor", () => {
		expect(routeChanged(synced(editRoute(SELF_SERVE)), listRoute, shared).model.editor).toBeNull()
	})
})
