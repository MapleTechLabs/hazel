import { Schema, Stream } from "effect"
import { Submodel, Subscription } from "foldkit"
import { describe, expect, test } from "vitest"
import { definePage, type PageHost, type PageSubscriptionInput, type Shared } from "./contract"

/** Every page goes through `definePage`, so its Subscriptions follow the page instance (its key). */

const Model = Schema.Struct({ userId: Schema.String })
type Model = typeof Model.Type

// A `{}` entry: nothing in the page Model restarts it (the users stream of the org-switch bug).
const subscriptions = Subscription.make<PageSubscriptionInput<Model>, string>()((entry) => ({
	rows: entry({}, { modelToDependencies: () => ({}), dependenciesToStream: () => Stream.make("rows") }),
}))

const page = definePage(
	"Fake",
	{ Model, Message: Schema.String },
	{
		routes: ["Profile"],
		key: (route) => route.userId,
		init: (route) => ({ model: { userId: route.userId } }),
		update: (model) => ({ model }),
		view: Submodel.defineView((_model, _inputs, h) => h.empty),
		subscriptions,
	},
)

const shared = {} as Shared
const hostOn = (key: string): PageHost => ({
	page: { _tag: "Fake", key, model: { userId: key } } as PageHost["page"],
	shared,
})
const entry = page.subscriptions["Fake.rows"]!
const isSame = Schema.toEquivalence(entry.dependenciesSchema)

describe("page Subscriptions follow the page instance", () => {
	test("the same instance keeps an entry running", () => {
		expect(isSame(entry.modelToDependencies(hostOn("a")), entry.modelToDependencies(hostOn("a")))).toBe(
			true,
		)
	})

	test("a new instance restarts even an entry with no dependencies of its own", () => {
		expect(isSame(entry.modelToDependencies(hostOn("a")), entry.modelToDependencies(hostOn("b")))).toBe(
			false,
		)
	})

	test("another page stops it", () => {
		expect(
			isSame(entry.modelToDependencies(hostOn("a")), entry.modelToDependencies({ page: null, shared })),
		).toBe(false)
	})
})
