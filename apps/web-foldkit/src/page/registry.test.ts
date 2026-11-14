// @vitest-environment jsdom
import { beforeAll, describe, expect, test } from "vitest"
import { AppRoute } from "../route"
import { makeShared } from "../test/pages-fixtures"
import * as Lazy from "./lazy"
import { areas, enterRoute, loadPages, pages, updatePage } from "./registry"

/** The page areas outside the first chunk (`lazy.ts`): what each owns, and how a route of one opens. */

const shared = makeShared()
const overview = AppRoute.CustomersOverview({ orgSlug: "hazel" })

// In order: the first test needs the areas not loaded yet.
describe("a route of an area", () => {
	test("waits in the pending slot until the area's chunk is here, then opens its page", async () => {
		const entered = enterRoute(null, overview, shared, 4)
		expect(entered.slot).toMatchObject({ _tag: "PagePending", key: "Customers", instance: 4 })
		expect(entered.commands?.map((command) => command.name)).toEqual(["LoadPages"])

		await loadPages()
		const loadedPages: Lazy.Wrapped = {
			_tag: "PagePending",
			key: "Customers#4",
			message: Lazy.Message.LoadedPages(),
		}
		const opened = updatePage(entered.slot, loadedPages, shared)
		expect(opened.slot).toMatchObject({ _tag: "CustomersOverview", instance: 4 })
	})

	test("opens at once when the area is loaded", async () => {
		await loadPages()
		expect(enterRoute(null, overview, shared, 5).slot?._tag).toBe("CustomersOverview")
	})
})

describe("the areas", () => {
	// Each loads them itself, so a test run alone still checks every page.
	beforeAll(loadPages)
	const loadedAreas = () => areas.map((area) => ({ area, pages: area.pages() ?? [] }))

	test("are all loaded by loadPages", () => {
		for (const area of loadedAreas()) expect(area.pages.length, area.area.id).toBeGreaterThan(0)
	})

	// A page whose route its area does not own could never be entered.
	test("own every route of their pages", () => {
		for (const area of loadedAreas())
			for (const page of area.pages)
				for (const tag of page.routes)
					expect(area.area.ownsRoute({ _tag: tag } as AppRoute), `${area.area.id}: ${tag}`).toBe(
						true,
					)
	})

	test("give every page an id of its own, and leave the first chunk's routes alone", () => {
		const ids = [...pages, ...loadedAreas().flatMap((area) => area.pages)].map((page) => page.id)
		expect(new Set(ids).size).toBe(ids.length)
		for (const page of pages)
			for (const tag of page.routes)
				for (const area of areas)
					expect(area.ownsRoute({ _tag: tag } as AppRoute), `${area.id}: ${tag}`).toBe(false)
	})

	// A Subscription beyond the pool would never run.
	test("declare no more Subscriptions per page than the pool runs", () => {
		for (const area of loadedAreas())
			for (const page of area.pages)
				expect(Object.keys(page.subscriptions).length, page.id).toBeLessThanOrEqual(
					Lazy.SUBSCRIPTION_POOL_SIZE,
				)
	})
})
