import { UserId } from "@hazel/schema"
import { Effect, Option, Schema, Stream } from "effect"
import { Submodel, Subscription } from "foldkit"
import { describe, expect, test } from "vitest"
import { AppRoute } from "../route"
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

describe("a Command's answer reaches only the page instance that sent it", () => {
	const Counted = Schema.Struct({ userId: Schema.String, answers: Schema.Array(Schema.String) })
	const answering = definePage(
		"Answering",
		{ Model: Counted, Message: Schema.String },
		{
			routes: ["Profile"],
			key: (route) => route.userId,
			init: (route) => ({
				model: { userId: route.userId, answers: [] },
				commands: [{ name: "Answer", effect: Effect.succeed(`for ${route.userId}`) }],
			}),
			update: (model, message) => ({ model: { ...model, answers: [...model.answers, message] } }),
			view: Submodel.defineView((_model, _inputs, h) => h.empty),
		},
	)
	const userOf = (id: number) => Schema.decodeSync(UserId)(`00000000-0000-4000-8000-00000000000${id}`)
	const enter = (id: number) =>
		Option.getOrThrow(answering.init(AppRoute.Profile({ orgSlug: "hazel", userId: userOf(id) }), shared))
	// The Command needs no resource: its answer is a plain value.
	const answerOf = (step: ReturnType<typeof enter>) =>
		Effect.runSync(step.commands[0]!.effect as Effect.Effect<typeof answering.Wrapped.Type>)
	const answersAfter = (step: ReturnType<typeof enter>, message: ReturnType<typeof answerOf>) =>
		Option.match(answering.update(step.slot, message, shared), {
			onNone: () => step.slot.model.answers,
			onSome: (next) => next.slot.model.answers,
		})

	test("the instance that sent it takes it", () => {
		const first = enter(1)
		expect(answersAfter(first, answerOf(first))).toEqual([`for ${userOf(1)}`])
	})

	test("another instance of the same page drops it", () => {
		expect(answersAfter(enter(2), answerOf(enter(1)))).toEqual([])
	})

	test("a view or Subscription Message (no key) reaches the current instance", () => {
		expect(answersAfter(enter(2), { _tag: "Answering", message: "clicked" })).toEqual(["clicked"])
	})
})
