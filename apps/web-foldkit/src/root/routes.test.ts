import { ChannelId } from "@hazel/schema"
import { Option } from "effect"
import { describe, expect, test } from "vitest"
import { AppRoute, hrefOf } from "../route"
import { AppRoutes, pathOf, routeOfHref } from "./routes"

const channelId = ChannelId.make("00000000-0000-4000-8000-000000000001")

describe("the Router's route table", () => {
	test("today's URLs parse to today's routes and print back the same", () => {
		const routes = [
			AppRoute.Root(),
			AppRoute.ChatIndex({ orgSlug: "hazel" }),
			AppRoute.ChatChannel({ orgSlug: "hazel", channelId }),
			AppRoute.SettingsGeneral({ orgSlug: "hazel" }),
			AppRoute.CustomersList({ orgSlug: "hazel", view: Option.some("paying") }),
			AppRoute.SignIn({ redirectUrl: Option.some("/hazel/chat"), error: Option.none() }),
		]
		for (const route of routes) {
			const href = AppRoutes.print(route)
			expect(href).toBe(hrefOf(route))
			expect(AppRoutes.parse(href)).toEqual(Option.some(route))
		}
	})

	test("an unknown path is NotFound, as today, so it stays in the app", () => {
		const resolved = Option.getOrThrow(AppRoutes.resolve("/nope/at/all"))
		expect(resolved.route._tag).toBe("NotFound")
		expect(resolved.notFound).toBe(true)
		expect(resolved.redirected).toBe(false)
	})

	test("another origin is not the app's: the browser loads it", () => {
		expect(routeOfHref("https://example.com/x")).toEqual(Option.none())
		expect(routeOfHref("//example.com/x")).toEqual(Option.none())
	})

	test("the printed path leaves the search out", () => {
		const route = AppRoute.CustomersList({ orgSlug: "hazel", view: Option.some("paying") })
		expect(pathOf(route)).toBe("/hazel/customers/list")
		expect(AppRoutes.printPath(route)).toBe("/hazel/customers/list")
	})
})
