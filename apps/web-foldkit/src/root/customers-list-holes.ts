// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Where the shell places the customers list's hazel controls and table: in today's Foldkit list
 * page's holes. The bridge (`customers-list.ts`) loads as its own chunk. Part of the adapter.
 */
import { Component, type View } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { OrganizationId, UserId } from "@hazel/schema"
import type { AppRoute } from "../route"
import type { AppMessage } from "./message"
import { Hole } from "./portal"

const CustomersListHole = Component.lazy("CustomersListHole", () =>
	import("./customers-list").then((module) => module.CustomersListHole),
)

/** The list's two holes, on its route only; the page keys them by org, as its own instance. */
export const customersListHoles = (
	h: Html.H<AppMessage>,
	route: AppRoute,
	organizationId: OrganizationId,
	userId: UserId,
): ReadonlyArray<View.Content<AppMessage, any>> =>
	route._tag !== "CustomersList"
		? []
		: (["controls", "table"] as const).map((part) =>
				Hole(
					h,
					{
						hole: part === "controls" ? "customers-list-controls" : "customers-list-table",
						key: route.orgSlug,
						matchKey: true,
					},
					[
						CustomersListHole(h, {
							key: `${part}:${organizationId}`,
							props: { organizationId, userId, part },
						}),
					],
				),
			)
