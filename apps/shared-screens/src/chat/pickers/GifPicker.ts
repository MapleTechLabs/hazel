// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The chat's GIF picker (today's `web-foldkit/src/gif-picker/`): the `GifPicker` extension (web only)
 * over the provider's queries (KLIPY on the web, implemented by the host). The screen owns the search:
 * trending and the category chips on open, the typed text or a chip's query, a page more when the
 * list nears its end, and a retry after a failure. The parent owns `open`; a pick reports `Picked`.
 */
import { Query, Subscription, UiSchema } from "@effect/ui"
import { GifCategory, GifPicker as GifPickerExtension, GifItem } from "@hazel/ui/extensions/GifPicker"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Schema, Stream } from "effect"

/** One result: the HD URL a pick sends, the small still and its animation, and its size. */
export const Gif = GifItem
export type Gif = typeof Gif.Type

/** Why a search failed: the provider itself, or anything else on the way. */
export const GifFailure = Schema.Literals(["ProviderFailed", "Unavailable"])
export type GifFailure = typeof GifFailure.Type

/** One page of results ("" is trending), and whether there is another. */
export const GifPage = Schema.Struct({ gifs: Schema.Array(Gif), hasNext: Schema.Boolean })
export type GifPage = typeof GifPage.Type

export class SearchGifs extends Query.Service<SearchGifs>()("hazel/pickers/SearchGifs", {
	args: { query: Schema.String, page: Schema.Finite },
	success: GifPage,
	error: GifFailure,
	staleTime: "5 minutes",
}) {}

/** The provider's categories, for the chips under the search field. */
export class GifCategories extends Query.Service<GifCategories>()("hazel/pickers/GifCategories", {
	args: {},
	success: Schema.Array(GifCategory),
	error: GifFailure,
	staleTime: "1 hour",
}) {}

/** Today's failure copy (`gif-picker/view.ts` `failureCopy`). */
export const failureText = (reason: GifFailure) =>
	reason === "ProviderFailed"
		? { title: "GIFs are unavailable", description: "KLIPY didn't respond. Please try again." }
		: { title: "Service temporarily unavailable", description: "Please try again in a moment." }

export const GifPickerProps = Schema.Struct({ open: Schema.Boolean })
export type GifPickerProps = typeof GifPickerProps.Type

const Status = Schema.Literals(["loading", "ready", "failed"])
const Paging = Schema.Literals(["idle", "loading", "done", "failed"])

export const GifPickerModel = Schema.Struct({
	/** The typed text; a chip's query wins while one is pressed. */
	query: Schema.String,
	category: Schema.NullOr(Schema.String),
	gifs: Schema.Array(Gif),
	/** The last page loaded (or loading). */
	page: Schema.Finite,
	status: Status,
	paging: Paging,
	failure: Schema.NullOr(GifFailure),
	categories: Schema.NullOr(Schema.Array(GifCategory)),
	categoriesFailed: Schema.Boolean,
	/** Bumped by a retry: the same page asked again. */
	attempt: Schema.Finite,
	categoriesAttempt: Schema.Finite,
})
export type GifPickerModel = typeof GifPickerModel.Type

export const GifPickerMessage = UiSchema.TaggedEnum({
	ChangedQuery: { text: Schema.String },
	ChoseCategory: { query: Schema.String },
	ReachedEnd: {},
	Retried: {},
	RetriedCategories: {},
	LoadedPage: { search: Schema.String, page: Schema.Finite, result: GifPage },
	FailedPage: { search: Schema.String, page: Schema.Finite, reason: GifFailure },
	LoadedCategories: { categories: Schema.Array(GifCategory) },
	FailedCategories: {},
	SelectedGif: { url: Schema.String },
	DismissedGifPicker: {},
})
export type GifPickerMessage = typeof GifPickerMessage.Type

export const GifPickerEvents = UiSchema.TaggedEnum({
	Picked: { url: Schema.String },
	RequestedClose: {},
})
export type GifPickerEvents = typeof GifPickerEvents.Type

/** What the results answer: the pressed chip's query, else the typed text. */
export const searchOf = (model: GifPickerModel) => model.category ?? model.query

/** A new search: page 1, the list cleared. */
const restart = (model: GifPickerModel, patch: Partial<GifPickerModel>): GifPickerModel => ({
	...model,
	...patch,
	gifs: [],
	page: 1,
	status: "loading",
	paging: "idle",
	failure: null,
})

export const pageStream = (search: string, page: number) =>
	Stream.fromEffect(
		SearchGifs.get({ query: search, page }).pipe(
			Effect.map((result) => GifPickerMessage.LoadedPage({ search, page, result })),
			Effect.catch((reason) => Effect.succeed(GifPickerMessage.FailedPage({ search, page, reason }))),
		),
	)

export const categoriesStream = Stream.fromEffect(
	GifCategories.get({}).pipe(
		Effect.map((categories) => GifPickerMessage.LoadedCategories({ categories })),
		Effect.orElseSucceed(() => GifPickerMessage.FailedCategories()),
	),
)

export const GifPicker = Hazel.component({
	name: "GifPicker",
	props: GifPickerProps,
	model: GifPickerModel,
	message: GifPickerMessage,
	events: GifPickerEvents,
}).make({
	init: () => ({
		query: "",
		category: null,
		gifs: [],
		page: 1,
		status: "loading" as const,
		paging: "idle" as const,
		failure: null,
		categories: null,
		categoriesFailed: false,
		attempt: 0,
		categoriesAttempt: 0,
	}),
	update: {
		ChangedQuery: ($, { text }) =>
			text === $.model.query && $.model.category === null
				? $.model
				: restart($.model, { query: text, category: null }),
		// The pressed chip again goes back to trending.
		ChoseCategory: ($, { query }) => restart($.model, { category: query === "" ? null : query }),
		ReachedEnd: ($) =>
			$.model.paging === "idle" && $.model.status === "ready"
				? $.evolve({ page: (page) => page + 1, paging: () => "loading" as const })
				: $.model,
		Retried: ($) =>
			$.evolve({
				attempt: (attempt) => attempt + 1,
				status: (status) => (status === "failed" ? ("loading" as const) : status),
				paging: (paging) => (paging === "failed" ? ("loading" as const) : paging),
				failure: () => null,
			}),
		RetriedCategories: ($) =>
			$.evolve({ categoriesFailed: () => false, categoriesAttempt: (attempt) => attempt + 1 }),
		// A page for an older search or page is stale and dropped.
		LoadedPage: ($, { search, page, result }) =>
			search !== searchOf($.model) || page !== $.model.page
				? $.model
				: $.evolve({
						gifs: (gifs) => (page === 1 ? result.gifs : [...gifs, ...result.gifs]),
						status: () => "ready" as const,
						paging: () => (result.hasNext ? ("idle" as const) : ("done" as const)),
					}),
		FailedPage: ($, { search, page, reason }) =>
			search !== searchOf($.model) || page !== $.model.page
				? $.model
				: page === 1
					? $.evolve({ status: () => "failed" as const, failure: () => reason })
					: $.evolve({ paging: () => "failed" as const, failure: () => reason }),
		LoadedCategories: ($, { categories }) => $.evolve({ categories: () => categories }),
		FailedCategories: ($) => $.evolve({ categoriesFailed: () => true }),
		SelectedGif: ($, { url }) => $.emit(GifPickerEvents.Picked({ url })),
		DismissedGifPicker: ($) => $.emit(GifPickerEvents.RequestedClose()),
	},
	subscriptions: ({ props, model }) => {
		const loading = model.status === "loading" || model.paging === "loading"
		return [
			props.open &&
				loading &&
				Subscription.make("page", [searchOf(model), model.page, model.attempt], () =>
					pageStream(searchOf(model), model.page),
				),
			props.open &&
				model.categories === null &&
				!model.categoriesFailed &&
				Subscription.make("categories", [model.categoriesAttempt], () => categoriesStream),
		]
	},
	// Web only: iOS draws nothing in its place.
	view: (h, model) =>
		h
			.extension(GifPickerExtension, {
				open: h.props.open,
				gifs: model.gifs,
				categories: model.categories ?? [],
				...(model.category === null ? {} : { category: model.category }),
				categoriesFailed: model.categoriesFailed,
				status: model.status,
				...(model.failure === null ? {} : { failure: failureText(model.failure) }),
				paging: model.paging,
			})
			.on("select", ({ url }) => GifPickerMessage.SelectedGif({ url }))
			.on("query", ({ text }) => GifPickerMessage.ChangedQuery({ text }))
			.on("category", ({ query }) => GifPickerMessage.ChoseCategory({ query }))
			.on("reachEnd", () => GifPickerMessage.ReachedEnd())
			.on("retry", () => GifPickerMessage.Retried())
			.on("retryCategories", () => GifPickerMessage.RetriedCategories())
			.on("dismiss", GifPickerMessage.DismissedGifPicker()),
})
