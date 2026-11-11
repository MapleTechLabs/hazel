import type { KlipyGif } from "@hazel/domain/http"
import { Duration, Effect, Option, Result, Schema } from "effect"
import { AsyncData, Command, Update } from "foldkit"
import * as Dom from "foldkit/dom"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { CommonReason } from "~/lib/error-messages"
import { catchCommon } from "../data/actions"
import { PopoverEvent } from "../picker-popover/popover"
import { HazelApiClient } from "../rpc"
import { searchFieldIds } from "../ui/search-field"

/**
 * `GifPickerDialog` with `useKlipy`: trending GIFs and categories on open, a 300ms debounced
 * search, category chips, load-more paging, and the selected GIF's HD URL out.
 */

const PER_PAGE = 25
const SEARCH_DEBOUNCE = Duration.millis(300)

// MODEL

export const Gif = Schema.Struct({
	slug: Schema.String,
	title: Schema.String,
	width: Schema.Number,
	height: Schema.Number,
	jpgUrl: Schema.String,
	webpUrl: Schema.String,
	hdGifUrl: Schema.String,
})
export type Gif = typeof Gif.Type

export const Category = Schema.Struct({ category: Schema.String, query: Schema.String })

/** What can go wrong fetching from KLIPY: the provider itself failing (`KlipyApiError`), or the shared reasons. */
export const GifFailure = Schema.Union([Schema.Literals(["ProviderFailed"]), CommonReason])
export type GifFailure = typeof GifFailure.Type

/** The GIFs loaded so far for one query, through `page`. */
export const GifPage = Schema.Struct({ gifs: Schema.Array(Gif), page: Schema.Number })
export type GifPage = typeof GifPage.Type

export const GifResults = AsyncData.Schema(GifPage, GifFailure)
export const Categories = AsyncData.Schema(Schema.Array(Category), GifFailure)

/** Paging past the first page: ready, fetching, failed (with why), or nothing left. */
export const More = Schema.Union([
	Schema.TaggedStruct("Idle", {}),
	Schema.TaggedStruct("Loading", {}),
	Schema.TaggedStruct("Failed", { reason: GifFailure }),
	Schema.TaggedStruct("Exhausted", {}),
])
export type More = typeof More.Type

const moreAfter = (hasMore: boolean): More => (hasMore ? { _tag: "Idle" } : { _tag: "Exhausted" })

export const Model = Schema.Struct({
	id: Schema.String,
	isOpen: Schema.Boolean,
	query: Schema.String,
	selectedCategory: Schema.NullOr(Schema.String),
	categories: Categories.schema,
	/** The query `results` answer, or are loading for ("" is trending). Responses for any other query are stale. */
	currentQuery: Schema.String,
	results: GifResults.schema,
	more: More,
	debounceVersion: Schema.Number,
	hoveredSlug: Schema.NullOr(Schema.String),
	/** The trending query's first page; going back to "" shows it without refetching. */
	trending: Schema.NullOr(Schema.Struct({ page: GifPage, hasMore: Schema.Boolean })),
})
export type Model = typeof Model.Type

export const init = (id: string): Model => ({
	id,
	isOpen: false,
	query: "",
	selectedCategory: null,
	categories: AsyncData.Idle(),
	currentQuery: "",
	results: AsyncData.Idle(),
	more: { _tag: "Idle" },
	debounceVersion: 0,
	hoveredSlug: null,
	trending: null,
})

export const searchInputId = (model: Model) => searchFieldIds(`${model.id}-search`).input

/** The GIFs on screen (none while the first page loads or failed). */
export const gifsOf = (model: Model): ReadonlyArray<Gif> =>
	Option.match(AsyncData.getData(model.results), { onNone: () => [], onSome: (page) => page.gifs })

// MESSAGE

export const Message = defineMessageUnion({
	ReceivedPopoverEvent: { event: PopoverEvent },
	UpdatedQuery: { query: Schema.String },
	ClickedCategory: { category: Schema.String },
	CompletedWaitForGifSearch: { version: Schema.Number },
	SucceededFetchGifs: {
		query: Schema.String,
		page: Schema.Number,
		gifs: Schema.Array(Gif),
		hasMore: Schema.Boolean,
	},
	FailedFetchGifs: { query: Schema.String, page: Schema.Number, reason: GifFailure },
	ClickedRetryFetchGifs: {},
	SucceededFetchCategories: { categories: Schema.Array(Category) },
	FailedFetchCategories: { reason: GifFailure },
	ClickedRetryFetchCategories: {},
	ScrolledNearEnd: {},
	HoveredGif: { slug: Schema.NullOr(Schema.String) },
	ClickedGif: { slug: Schema.String },
	CompletedFocusGifSearch: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ SelectedGif: { url: Schema.String } })
export type OutMessage = typeof OutMessage.Type

// COMMAND

const toGif = (gif: KlipyGif): Gif => ({
	slug: gif.slug,
	title: gif.title,
	width: gif.file.sm.gif.width,
	height: gif.file.sm.gif.height,
	jpgUrl: gif.file.sm.jpg.url,
	webpUrl: gif.file.sm.webp.url,
	hdGifUrl: gif.file.hd.gif.url,
})

/** `fetchGifs`: `klipy.search` with a query, `klipy.trending` without. */
export const FetchGifs = Command.define("FetchGifs", {
	args: { query: Schema.String, page: Schema.Number },
	messages: [Message.SucceededFetchGifs, Message.FailedFetchGifs],
	execute: ({ query, page }) =>
		(query
			? HazelApiClient.use((client) =>
					client.klipy.search({ query: { q: query, page, per_page: PER_PAGE } }),
				)
			: HazelApiClient.use((client) => client.klipy.trending({ query: { page, per_page: PER_PAGE } }))
		).pipe(
			Effect.map((response) =>
				Message.SucceededFetchGifs({
					query,
					page: response.current_page,
					gifs: response.data.map(toGif),
					hasMore: response.has_next,
				}),
			),
			Effect.catchTags({
				KlipyApiError: () =>
					Effect.succeed(Message.FailedFetchGifs({ query, page, reason: "ProviderFailed" })),
			}),
			catchCommon((reason) => Message.FailedFetchGifs({ query, page, reason })),
		),
})

export const FetchCategories = Command.define("FetchCategories", {
	messages: [Message.SucceededFetchCategories, Message.FailedFetchCategories],
	execute: HazelApiClient.use((client) => client.klipy.categories()).pipe(
		Effect.map((response) =>
			Message.SucceededFetchCategories({
				categories: response.categories.map(({ category, query }) => ({ category, query })),
			}),
		),
		Effect.catchTags({
			KlipyApiError: () => Effect.succeed(Message.FailedFetchCategories({ reason: "ProviderFailed" })),
		}),
		catchCommon((reason) => Message.FailedFetchCategories({ reason })),
	),
})

export const WaitForGifSearch = Command.define("WaitForGifSearch", {
	args: { version: Schema.Number },
	messages: [Message.CompletedWaitForGifSearch],
	interrupt: true,
	execute: ({ version }) =>
		Effect.sleep(SEARCH_DEBOUNCE).pipe(Effect.as(Message.CompletedWaitForGifSearch({ version }))),
})

/** `SearchField autoFocus`: focus the search input once the popover is in the DOM. */
export const FocusGifSearch = Command.define("FocusGifSearch", {
	args: { inputId: Schema.String },
	messages: [Message.CompletedFocusGifSearch],
	execute: ({ inputId }) =>
		Dom.focus(`#${CSS.escape(inputId)}`, { preventScroll: true }).pipe(
			// Best effort: a popover closed before the focus lands has no input to focus.
			Effect.ignore,
			Effect.as(Message.CompletedFocusGifSearch()),
		),
})

// UPDATE

export type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage, HazelApiClient>
type StepReturn = Update.Return<Model, Message, HazelApiClient>

/** The first page of `query`, replacing whatever was shown. */
const fetchFirstPage = (model: Model, query: string): StepReturn => ({
	model: modifyFields(model, {
		currentQuery: () => query,
		results: () => AsyncData.Loading(),
		more: (): More => ({ _tag: "Idle" }),
	}),
	commands: [FetchGifs({ query, page: 1 })],
})

/** `search(query)`: a fresh first page ("" goes back to the cached trending page when there is one). */
const runSearch = (model: Model, query: string): Return => {
	const { trending } = model
	return query === "" && trending !== null
		? {
				model: modifyFields(model, {
					currentQuery: () => "",
					results: () => GifResults.Success({ data: trending.page }),
					more: () => moreAfter(trending.hasMore),
				}),
			}
		: fetchFirstPage(model, query)
}

/** `loadMore`: the next page of the current query. */
const fetchNextPage = (model: Model, current: GifPage): Return => ({
	model: modifyFields(model, { more: (): More => ({ _tag: "Loading" }) }),
	commands: [FetchGifs({ query: model.currentQuery, page: current.page + 1 })],
})

const loadedPage = (model: Model): Option.Option<GifPage> =>
	AsyncData.isSuccess(model.results) ? AsyncData.getData(model.results) : Option.none()

const close = (model: Model): Return => ({ model: modifyFields(model, { isOpen: () => false }) })

/** Opening starts over: trending, the categories, and focus in the search field. */
const open = (model: Model): Return =>
	Update.combine<Model, Message, HazelApiClient>(modifyFields(init(model.id), { isOpen: () => true }), [
		(opened) => fetchFirstPage(opened, ""),
		(opened) => ({
			model: modifyFields(opened, { categories: () => Categories.Loading() }),
			commands: [FetchCategories(), FocusGifSearch({ inputId: searchInputId(opened) })],
		}),
	])

/** A first-page response still answers what is on screen: the same query, and it is still loading. */
const isAwaitedFirstPage = (model: Model, query: string) =>
	query === model.currentQuery && AsyncData.isPending(model.results)

/** A next-page response still extends what is on screen: the same query, the page after, still loading. */
const isAwaitedNextPage = (model: Model, query: string, page: number) =>
	query === model.currentQuery &&
	model.more._tag === "Loading" &&
	Option.exists(loadedPage(model), (current) => current.page + 1 === page)

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		ReceivedPopoverEvent: ({ event }) =>
			PopoverEvent.match<Return>(event, {
				ClickedTrigger: () => (model.isOpen ? close(model) : open(model)),
				ClickedDismiss: () => close(model),
				PressedEscape: () => close(model),
				PressedOutside: () => close(model),
				CompletedPortalPickerPopover: () => ({ model }),
			}),
		UpdatedQuery: ({ query }) => {
			const debounceVersion = model.debounceVersion + 1
			return {
				model: modifyFields(model, {
					query: () => query,
					selectedCategory: () => null,
					debounceVersion: () => debounceVersion,
				}),
				commands: [WaitForGifSearch({ version: debounceVersion })],
			}
		},
		CompletedWaitForGifSearch: ({ version }) =>
			version === model.debounceVersion ? runSearch(model, model.query) : { model },
		// Selecting the selected chip again goes back to trending.
		ClickedCategory: ({ category }) => {
			const next = model.selectedCategory === category ? null : category
			return runSearch(
				modifyFields(model, {
					selectedCategory: () => next,
					debounceVersion: (version) => version + 1,
				}),
				next ?? "",
			)
		},
		SucceededFetchGifs: ({ query, page, gifs, hasMore }) => {
			if (page === 1) {
				if (!isAwaitedFirstPage(model, query)) return { model }
				const loaded: GifPage = { gifs, page }
				return {
					model: modifyFields(model, {
						results: () => GifResults.Success({ data: loaded }),
						more: () => moreAfter(hasMore),
						trending: (trending) =>
							query === "" && trending === null ? { page: loaded, hasMore } : trending,
					}),
				}
			}
			if (!isAwaitedNextPage(model, query, page)) return { model }
			return {
				model: modifyFields(model, {
					results: (results) =>
						AsyncData.map(results, (current) => ({ gifs: [...current.gifs, ...gifs], page })),
					more: () => moreAfter(hasMore),
				}),
			}
		},
		FailedFetchGifs: ({ query, page, reason }) => {
			if (page === 1)
				return isAwaitedFirstPage(model, query)
					? {
							model: modifyFields(model, {
								results: (results) => AsyncData.settle(results, Result.fail(reason)),
							}),
						}
					: { model }
			return isAwaitedNextPage(model, query, page)
				? { model: modifyFields(model, { more: (): More => ({ _tag: "Failed", reason }) }) }
				: { model }
		},
		ClickedRetryFetchGifs: () => {
			if (AsyncData.isFailure(model.results)) return fetchFirstPage(model, model.currentQuery)
			return model.more._tag === "Failed"
				? Option.match(loadedPage(model), {
						onNone: () => ({ model }),
						onSome: (current) => fetchNextPage(model, current),
					})
				: { model }
		},
		SucceededFetchCategories: ({ categories }) => ({
			model: modifyFields(model, { categories: () => Categories.Success({ data: categories }) }),
		}),
		FailedFetchCategories: ({ reason }) => ({
			model: modifyFields(model, {
				categories: (previous) => AsyncData.settle(previous, Result.fail(reason)),
			}),
		}),
		ClickedRetryFetchCategories: () => ({
			model: modifyFields(model, { categories: () => Categories.Loading() }),
			commands: [FetchCategories()],
		}),
		// `loadMore`: the next page of the current query, unless one is loading, failed or none is left.
		ScrolledNearEnd: () =>
			model.more._tag !== "Idle"
				? { model }
				: Option.match(loadedPage(model), {
						onNone: () => ({ model }),
						onSome: (current) =>
							current.gifs.length === 0 ? { model } : fetchNextPage(model, current),
					}),
		HoveredGif: ({ slug }) => ({ model: modifyFields(model, { hoveredSlug: () => slug }) }),
		CompletedFocusGifSearch: () => ({ model }),
		ClickedGif: ({ slug }) => {
			const gif = gifsOf(model).find((candidate) => candidate.slug === slug)
			return gif === undefined
				? { model }
				: {
						model: modifyFields(model, { isOpen: () => false }),
						outMessage: OutMessage.SelectedGif({ url: gif.hdGifUrl }),
					}
		},
	})
