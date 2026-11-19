import { DragAndDrop } from "@foldkit/ui"
import { CustomerSavedViewId, CustomerViewLayoutId, OrganizationId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { describe, expect, test } from "vitest"
import type { SavedViewRow } from "../customers/queries"
import { init, Message, type Model, setOrganization, sidebarViewsOf, update } from "./customers-sidebar"

/** The Customers sidebar's rows belong to one organization; its views follow my layout. */

const org = (n: number) =>
	Schema.decodeSync(OrganizationId)(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`)
const me = Schema.decodeSync(UserId)("00000000-0000-4000-8000-000000000099")
const viewId = Schema.decodeSync(CustomerSavedViewId)("00000000-0000-4000-8000-000000000040")
const layoutId = Schema.decodeSync(CustomerViewLayoutId)("00000000-0000-4000-8000-000000000050")

const paying: SavedViewRow = {
	id: Schema.decodeSync(CustomerSavedViewId)("00000000-0000-4000-8000-000000000041"),
	name: "Paying",
	builtInKey: "paying",
	ownerUserId: null,
	position: 0,
	icon: null,
	color: null,
}
const renewals: SavedViewRow = {
	id: viewId,
	name: "Renewals",
	builtInKey: null,
	ownerUserId: me,
	position: 1,
	icon: "rocket",
	color: "teal",
}

const loaded = (): Model =>
	update(
		setOrganization(init(), org(1)),
		Message.UpdatedSavedViews({ organizationId: org(1), views: [paying, renewals] }),
		me,
	).model
const keysOf = (model: Model) => sidebarViewsOf(model).map((view) => view.key)

describe("customers sidebar", () => {
	test("switching organizations drops the previous one's count and views, and its late rows", () => {
		const first = setOrganization(init(), org(1))
		const counted = update(
			first,
			Message.UpdatedAttentionCount({ organizationId: org(1), count: 4 }),
			me,
		).model
		expect(counted.attentionCount).toBe(4)
		const switched = setOrganization(counted, org(2))
		expect(switched).toEqual({ ...init(), organizationId: org(2) })
		const late = update(
			switched,
			Message.UpdatedAttentionCount({ organizationId: org(1), count: 9 }),
			me,
		).model
		expect(late.attentionCount).toBeNull()
	})

	test("Current customers leads by default; All customers stays out until shown", () => {
		expect(keysOf(loaded())).toEqual(["current", "paying", viewId])
		expect(sidebarViewsOf(loaded())[2]?.look).toEqual({ icon: "rocket", color: "teal" })
	})

	test("my layout orders the views and hides some; a view made since follows its neighbour", () => {
		const arranged = update(
			loaded(),
			Message.UpdatedViewLayout({
				organizationId: org(1),
				layout: { id: layoutId, order: ["paying", "all", "current"], sidebarHidden: [] },
			}),
			me,
		).model
		expect(keysOf(arranged)).toEqual(["paying", viewId, "all", "current"])

		const hidden = update(arranged, Message.PressedHideView({ key: "paying" }), me)
		expect(keysOf(hidden.model)).toEqual([viewId, "all", "current"])
		expect(hidden.commands?.map((command) => command.name)).toEqual(["SaveSidebarLayout"])
		expect(hidden.commands?.[0]?.args).toMatchObject({ layoutId, sidebarHidden: ["paying"] })
	})

	test("dropping a dragged view saves the new order, the hidden views keeping their places", () => {
		const base = update(
			loaded(),
			Message.UpdatedViewLayout({
				organizationId: org(1),
				layout: { id: layoutId, order: [], sidebarHidden: ["paying", "all"] },
			}),
			me,
		).model
		expect(keysOf(base)).toEqual(["current", viewId])
		// Press "current", drag it past Renewals (index 1 among the others), release.
		const steps: ReadonlyArray<DragAndDrop.Message> = [
			DragAndDrop.Message.PressedDraggable({
				itemId: "current",
				containerId: "customers-sidebar-views",
				index: 0,
				screenX: 0,
				screenY: 0,
			}),
			DragAndDrop.Message.MovedPointer({
				screenX: 0,
				screenY: 40,
				clientX: 0,
				clientY: 40,
				maybeDropTarget: Option.some({ containerId: "customers-sidebar-views", index: 1 }),
			}),
			DragAndDrop.Message.ReleasedPointer(),
		]
		const dropped = steps.reduce<{ model: Model; names: ReadonlyArray<string> }>(
			(state, message) => {
				const result = update(state.model, Message.GotDragMessage({ message }), me)
				return {
					model: result.model,
					names: [...state.names, ...(result.commands ?? []).map((command) => command.name)],
				}
			},
			{ model: base, names: [] },
		)
		expect(keysOf(dropped.model)).toEqual([viewId, "current"])
		expect(dropped.model.layout?.order).toEqual([viewId, "paying", "current", "all"])
		expect(dropped.names).toEqual(["SaveSidebarLayout"])
	})
})
