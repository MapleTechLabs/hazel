// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** The customers sidebar as Stories: the views it shows, their reorder and hide, and the save's toast. */
import { Component } from "@effect/ui"
import { Story } from "@effect/ui/testing"
import { assert, describe, it } from "@effect/vitest"
import { CustomerSavedViewId, CustomerViewLayoutId, OrganizationId, UserId } from "@hazel/schema"
import { Effect } from "effect"
import { ShowToast } from "../app/requests"
import { errorToast } from "../modals/feedback"
import {
	CustomersSidebar,
	CustomersSidebarMessage,
	type Model,
	movedBefore,
	SaveViewLayout,
	sidebarViewsOf,
} from "./CustomersSidebar"

const organizationId = OrganizationId.make("00000001-0000-4000-8000-000000000001")
const userId = UserId.make("00000002-0000-4000-8000-000000000001")
const layoutId = CustomerViewLayoutId.make("00000009-0000-4000-8000-000000000001")
const enterprise = CustomerSavedViewId.make("00000008-0000-4000-8000-000000000001")

const props = {
	organizationId,
	userId,
	pages: [
		{
			id: "customersAttention",
			label: "Needs attention",
			icon: "warning" as const,
			href: "/hazel/customers/attention",
			selected: false,
		},
	],
	settings: [],
	listHref: "/hazel/customers/list",
	currentView: "current",
	account: {
		organizationId,
		userId,
		name: "Ada Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		hrefs: {
			profile: "/p",
			mySettings: "/m",
			manageMembers: "/t",
			serverSettings: "/s",
			customEmojis: "/e",
			integrations: "/i",
		},
	},
	sheet: null,
}

const empty: Model = { attentionCount: null, inboxCount: null, views: null, layout: null, layoutId: null }
const keysOf = (model: Model) => sidebarViewsOf(model).map((view) => view.key)

describe("CustomersSidebar", () => {
	it.effect("subscribes to the counts, the views and my layout, keyed by org and user", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(CustomersSidebar, props)
			for (const key of ["attention", "inbox", "views", "layout"])
				assert.isTrue(
					s.subscriptions.some((sub) => sub.startsWith(key)),
					key,
				)
		}),
	)

	it.effect("dragging a view saves my order; the list's tabs follow the same layout", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(CustomersSidebar, props)
			assert.deepStrictEqual(keysOf(s.model), [
				"current",
				"my_customers",
				"paying",
				"trialing",
				"churned",
			])
			s.send(CustomersSidebarMessage.MovedView({ id: "churned", before: "current" })).expectExact(
				SaveViewLayout,
			)
			assert.deepStrictEqual(keysOf(s.model), [
				"churned",
				"current",
				"my_customers",
				"paying",
				"trialing",
			])
			s.resolve(SaveViewLayout, CustomersSidebarMessage.CompletedSave({ toast: null }))
			// A drop where it was saves nothing.
			s.send(CustomersSidebarMessage.MovedView({ id: "churned", before: "current" }))
			assert.strictEqual(s.pending.length, 0)
		}),
	)

	it.effect("hiding a view leaves the sidebar, but never the last one", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(CustomersSidebar, props)
			s.send(
				CustomersSidebarMessage.UpdatedLayout({
					layout: {
						id: layoutId,
						order: [],
						sidebarHidden: ["all", "my_customers", "paying", "trialing"],
					},
				}),
			)
			s.send(CustomersSidebarMessage.PressedHideView({ key: "churned" })).expectExact(SaveViewLayout)
			s.resolve(SaveViewLayout, CustomersSidebarMessage.CompletedSave({ toast: null }))
			assert.deepStrictEqual(keysOf(s.model), ["current"])
			s.send(CustomersSidebarMessage.PressedHideView({ key: "current" }))
			assert.strictEqual(s.pending.length, 0)
			assert.deepStrictEqual(keysOf(s.model), ["current"])
		}),
	)

	it.effect("a failed save shows its toast", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(CustomersSidebar, props)
			s.send(CustomersSidebarMessage.PressedHideView({ key: "paying" })).expectExact(SaveViewLayout)
			s.resolve(
				SaveViewLayout,
				CustomersSidebarMessage.CompletedSave({ toast: errorToast({ title: "Connection lost" }) }),
			)
			s.expectExact(ShowToast)
			s.resolve(ShowToast, Component.noop)
		}),
	)

	it("synced views replace the built-ins, by key, in my order (All stays hidden by default)", () => {
		const model: Model = {
			...empty,
			views: [
				{
					id: enterprise,
					name: "Enterprise",
					builtInKey: null,
					ownerUserId: null,
					position: 0,
					icon: "star",
					color: "blue",
				},
			],
			layout: { order: [enterprise, "current"], sidebarHidden: ["all"] },
		}
		assert.deepStrictEqual(
			sidebarViewsOf(model).map((view) => [view.key, view.look]),
			[
				[enterprise, { icon: "star", color: "blue" }],
				["current", { icon: null, color: "purple" }],
			],
		)
	})

	it("a move before null goes to the end", () => {
		assert.deepStrictEqual(movedBefore(["a", "b", "c"], "a", null), ["b", "c", "a"])
		assert.deepStrictEqual(movedBefore(["a", "b", "c"], "c", "b"), ["a", "c", "b"])
	})
})
