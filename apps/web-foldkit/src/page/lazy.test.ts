// @vitest-environment jsdom
import { Context, Effect, Schema, Stream } from "effect"
import { Submodel, Subscription } from "foldkit"
import * as Scene from "foldkit/scene"
import { describe, expect, test } from "vitest"
import type { Resources } from "../rpc"
import { AppRoute } from "../route"
import { makeShared, userId } from "../test/pages-fixtures"
import { definePage, type PageHost, type PageSubscriptionInput } from "./contract"
import * as Lazy from "./lazy"

/** A page area in its own chunk: the pending slot until it loads, and its Subscriptions after. */

const Model = Schema.Struct({ userId: Schema.String, query: Schema.String })
type Model = typeof Model.Type

const page = definePage(
	"Fake",
	{ Model, Message: Schema.String },
	{
		routes: ["Profile"],
		init: (route) => ({ model: { userId: route.userId, query: "" } }),
		update: (model) => ({ model }),
		view: Submodel.defineView((_model, _inputs, h) => h.empty),
		subscriptions: Subscription.make<PageSubscriptionInput<Model>, string>()((entry) => ({
			rows: entry(
				{ query: Schema.String },
				{
					modelToDependencies: ({ model }) => ({ query: model.query }),
					dependenciesToStream: ({ query }) => Stream.make(`rows:${query}`),
				},
			),
		})),
	},
)

const route = AppRoute.Profile({ orgSlug: "hazel", userId })
const fakeArea = (importPages: () => Promise<{ readonly pages: ReadonlyArray<typeof page> }>) =>
	Lazy.lazyArea("Fake", AppRoute.isAnyOf(["Profile"]), importPages)

describe("a lazy area", () => {
	test("has no pages until its chunk has arrived", async () => {
		const area = fakeArea(() => Promise.resolve({ pages: [page] }))
		expect(area.pages()).toBeUndefined()
		expect(area.pageById("Fake")).toBeUndefined()
		await area.load()
		expect(area.pages()).toEqual([page])
		expect(area.pageById("Fake")).toBe(page)
	})

	test("fetches its chunk once", async () => {
		let fetches = 0
		const area = fakeArea(() => {
			fetches += 1
			return Promise.resolve({ pages: [page] })
		})
		await Promise.all([area.load(), area.load()])
		await area.load()
		expect(fetches).toBe(1)
	})

	// A deploy removes the previous build's chunks; the connection may also just have dropped.
	test("tries again after a failed fetch", async () => {
		let fetches = 0
		const area = fakeArea(() => {
			fetches += 1
			return fetches === 1 ? Promise.reject(new Error("offline")) : Promise.resolve({ pages: [page] })
		})
		await expect(area.load()).rejects.toThrow("offline")
		expect(area.pages()).toBeUndefined()
		await area.load()
		expect(area.pages()).toEqual([page])
	})
})

describe("the pending slot", () => {
	const area = fakeArea(() => Promise.resolve({ pages: [page] }))
	const entered = Lazy.enter(area, route, 3)
	const wrapped = (message: Lazy.Message, key = "Fake#3"): Lazy.Wrapped => ({
		_tag: "PagePending",
		key,
		message,
	})
	interface Stepped {
		readonly opened: AppRoute | null
		readonly slot: Lazy.Slot
		readonly commands: ReadonlyArray<string>
	}
	const names = (step: Lazy.PendingStep) => (step.commands ?? []).map((command) => command.name)
	const step = (slot: Lazy.Slot, message: Lazy.Wrapped): Stepped =>
		Lazy.update<Stepped>(
			slot,
			message,
			(opened) => ({ opened: opened.route, slot: opened, commands: [] }),
			(stayed) => ({ opened: null, slot: stayed.slot, commands: names(stayed) }),
		)

	test("remembers the route and fetches the area", () => {
		expect(entered.slot).toEqual({
			_tag: "PagePending",
			key: "Fake",
			instance: 3,
			route,
			hasFailed: false,
		})
		expect(names(entered)).toEqual(["LoadPages"])
		expect(entered.commands?.[0]?.args).toEqual({ area: "Fake" })
	})

	test("opens its route once the area has loaded", () => {
		expect(step(entered.slot, wrapped(Lazy.Message.LoadedPages())).opened).toEqual(route)
	})

	test("a failed fetch stays on the slot, which then offers a reload", () => {
		const failed = step(entered.slot, wrapped(Lazy.Message.FailedLoadPages()))
		expect(failed.slot).toEqual({ ...entered.slot, hasFailed: true })
		const reloading = step(failed.slot, wrapped(Lazy.Message.PressedReload()))
		expect(reloading.commands).toEqual(["ReloadForPages"])
	})

	// The user left and came back while the chunk loaded: the first visit's answer is not this one's.
	test("ignores the answer of another instance", () => {
		const late = step(entered.slot, wrapped(Lazy.Message.LoadedPages(), "Fake#2"))
		expect(late.opened).toBeNull()
		expect(late.slot).toBe(entered.slot)
	})

	const scene = {
		update: (slot: Lazy.Slot, _message: Lazy.Wrapped) => ({ model: slot }),
		view: Scene.withViewInputs(Lazy.view, { shared: makeShared() })(),
	}

	test("shows the loader while the chunk loads", () => {
		Scene.scene(
			scene,
			Scene.given(entered.slot),
			Scene.expect(Scene.role("progressbar", { name: "Loading" })).toExist(),
			Scene.expect(Scene.role("alert")).toBeAbsent(),
		)
	})

	test("says so when the chunk did not load, with a way to reload", () => {
		Scene.scene(
			scene,
			Scene.given({ ...entered.slot, hasFailed: true }),
			Scene.expect(Scene.role("heading", { name: "This page did not load" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Try again" })).toExist(),
		)
	})
})

describe("a lazy page's Subscriptions run in the pool", () => {
	const shared = makeShared()
	const hostOn = (query: string | null): PageHost => ({
		page:
			query === null
				? null
				: ({
						_tag: "Fake",
						key: "a",
						instance: 1,
						model: { userId: "a", query },
					} as PageHost["page"]),
		shared,
	})
	const pool = Lazy.pooledSubscriptions<{ readonly message: string }>((host) =>
		host.page?._tag === "Fake" ? Object.values(page.subscriptions) : [],
	)
	const first = pool["lazy.0"]!
	const isSame = first.keepAliveEquivalence!
	const messagesOf = (host: PageHost) => {
		const dependencies = first.modelToDependencies(host)
		// The entry needs no resource: its Stream is a plain value.
		return Effect.runSyncWith(Context.empty() as Context.Context<Resources>)(
			Stream.runCollect(first.dependenciesToStream(dependencies, () => dependencies)),
		)
	}

	test("the pool has a fixed number of entries", () => {
		expect(Object.keys(pool)).toHaveLength(Lazy.SUBSCRIPTION_POOL_SIZE)
	})

	test("an entry streams the page's Subscription", () => {
		expect(messagesOf(hostOn("ada"))).toMatchObject([{ _tag: "Fake", key: "a#1", message: "rows:ada" }])
	})

	test("an entry the page has no Subscription for stays empty", () => {
		const second = pool["lazy.1"]!
		const dependencies = second.modelToDependencies(hostOn("ada"))
		expect(dependencies.active).toBeNull()
		expect(messagesOf(hostOn(null))).toEqual([])
	})

	test("keeps running while the Subscription's own dependencies are equal", () => {
		expect(
			isSame(first.modelToDependencies(hostOn("ada")), first.modelToDependencies(hostOn("ada"))),
		).toBe(true)
	})

	test("restarts when they change, and when the page leaves", () => {
		const running = first.modelToDependencies(hostOn("ada"))
		expect(isSame(running, first.modelToDependencies(hostOn("grace")))).toBe(false)
		expect(isSame(running, first.modelToDependencies(hostOn(null)))).toBe(false)
		expect(isSame(first.modelToDependencies(hostOn(null)), first.modelToDependencies(hostOn(null)))).toBe(
			true,
		)
	})
})
