import type { KlipyGif } from "@hazel/domain/http"
import { Duration, Effect, Schema } from "effect"
import { Command, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { HazelApiClient } from "~/lib/services/common/atom-client"
import { runAtomFn } from "../data/actions"
import { PopoverEvent } from "../picker-popover/popover"

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

export const Model = Schema.Struct({
	id: Schema.String,
	isOpen: Schema.Boolean,
	query: Schema.String,
	selectedCategory: Schema.NullOr(Schema.String),
	categories: Schema.Array(Category),
	gifs: Schema.Array(Gif),
	isLoading: Schema.Boolean,
	isLoadingMore: Schema.Boolean,
	hasMore: Schema.Boolean,
	page: Schema.Number,
	/** The query the shown GIFs answer ("" is trending). */
	currentQuery: Schema.String,
	requestId: Schema.Number,
	debounceVersion: Schema.Number,
	hoveredSlug: Schema.NullOr(Schema.String),
	/** The trending query's first page; going back to "" shows it without refetching. */
	trending: Schema.NullOr(Schema.Struct({ gifs: Schema.Array(Gif), page: Schema.Number, hasMore: Schema.Boolean })),
})
export type Model = typeof Model.Type

export const init = (id: string): Model => ({
	id,
	isOpen: false,
	query: "",
	selectedCategory: null,
	categories: [],
	gifs: [],
	isLoading: true,
	isLoadingMore: false,
	hasMore: true,
	page: 1,
	currentQuery: "",
	requestId: 0,
	debounceVersion: 0,
	hoveredSlug: null,
	trending: null,
})

// MESSAGE

export const Message = defineMessageUnion({
	ReceivedPopoverEvent: { event: PopoverEvent },
	UpdatedQuery: { query: Schema.String },
	ClickedCategory: { category: Schema.String },
	CompletedWaitForGifSearch: { version: Schema.Number },
	SucceededFetchGifs: {
		requestId: Schema.Number,
		append: Schema.Boolean,
		gifs: Schema.Array(Gif),
		page: Schema.Number,
		hasMore: Schema.Boolean,
	},
	FailedFetchGifs: { requestId: Schema.Number },
	SucceededFetchCategories: { categories: Schema.Array(Category) },
	FailedFetchCategories: {},
	ScrolledNearEnd: {},
	HoveredGif: { slug: Schema.NullOr(Schema.String) },
	ClickedGif: { slug: Schema.String },
	CompletedFocusGifSearch: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ SelectedGif: { url: Schema.String } })
export type OutMessage = typeof OutMessage.Type

// COMMAND

const trending = HazelApiClient.mutation("klipy", "trending")
const search = HazelApiClient.mutation("klipy", "search")
const categories = HazelApiClient.mutation("klipy", "categories")

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
	args: { query: Schema.String, page: Schema.Number, append: Schema.Boolean, requestId: Schema.Number },
	messages: [Message.SucceededFetchGifs, Message.FailedFetchGifs],
	execute: ({ query, page, append, requestId }) =>
		(query
			? runAtomFn(search, { query: { q: query, page, per_page: PER_PAGE } })
			: runAtomFn(trending, { query: { page, per_page: PER_PAGE } })
		).pipe(
			Effect.map((response) =>
				Message.SucceededFetchGifs({
					requestId,
					append,
					gifs: response.data.map(toGif),
					page: response.current_page,
					hasMore: response.has_next,
				}),
			),
			Effect.catchCause(() => Effect.succeed(Message.FailedFetchGifs({ requestId }))),
		),
})

export const FetchCategories = Command.define("FetchCategories", {
	messages: [Message.SucceededFetchCategories, Message.FailedFetchCategories],
	execute: runAtomFn(categories, {}).pipe(
		Effect.map((response) =>
			Message.SucceededFetchCategories({
				categories: response.categories.map(({ category, query }) => ({ category, query })),
			}),
		),
		Effect.catchCause(() => Effect.succeed(Message.FailedFetchCategories())),
	),
})

export const WaitForGifSearch = Command.define("WaitForGifSearch", {
	args: { version: Schema.Number },
	messages: [Message.CompletedWaitForGifSearch],
	interrupt: true,
	execute: ({ version }) =>
		Effect.sleep(SEARCH_DEBOUNCE).pipe(Effect.as(Message.CompletedWaitForGifSearch({ version }))),
})

// UPDATE

export type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const fetch = (model: Model, query: string, page: number, append: boolean): Return => {
	const requestId = model.requestId + 1
	return {
		model: { ...model, requestId, isLoading: !append || model.isLoading, isLoadingMore: append },
		commands: [FetchGifs({ query, page, append, requestId })],
	}
}

/** `search(query)`: a fresh first page ("" goes back to trending). */
const runSearch = (model: Model, query: string): Return =>
	query === "" && model.trending !== null
		? {
				model: {
					...model,
					currentQuery: "",
					requestId: model.requestId + 1,
					gifs: model.trending.gifs,
					page: model.trending.page,
					hasMore: model.trending.hasMore,
					isLoading: false,
					isLoadingMore: false,
				},
			}
		: fetch({ ...model, currentQuery: query, page: 1, hasMore: true, gifs: [] }, query, 1, false)

const close = (model: Model): Return => ({ model: { ...model, isOpen: false } })

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		ReceivedPopoverEvent: ({ event }) =>
			PopoverEvent.match<Return>(event, {
				ClickedTrigger: () => {
					if (model.isOpen) return close(model)
					const opened = { ...init(model.id), isOpen: true, requestId: model.requestId }
					const first = fetch(opened, "", 1, false)
					return { ...first, commands: [...(first.commands ?? []), FetchCategories()] }
				},
				ClickedDismiss: () => close(model),
				PressedEscape: () => close(model),
				PressedOutside: () => close(model),
				CompletedPortalPickerPopover: () => ({ model }),
			}),
		UpdatedQuery: ({ query }) => {
			const debounceVersion = model.debounceVersion + 1
			return {
				model: { ...model, query, selectedCategory: null, debounceVersion },
				commands: [WaitForGifSearch({ version: debounceVersion })],
			}
		},
		CompletedWaitForGifSearch: ({ version }) =>
			version === model.debounceVersion ? runSearch(model, model.query) : { model },
		// Selecting the selected chip again goes back to trending.
		ClickedCategory: ({ category }) => {
			const next = model.selectedCategory === category ? null : category
			return runSearch({ ...model, selectedCategory: next, debounceVersion: model.debounceVersion + 1 }, next ?? "")
		},
		SucceededFetchGifs: ({ requestId, append, gifs, page, hasMore }) =>
			requestId !== model.requestId
				? { model }
				: {
						model: {
							...model,
							gifs: append ? [...model.gifs, ...gifs] : gifs,
							page,
							hasMore,
							isLoading: false,
							isLoadingMore: false,
							trending:
								model.currentQuery === "" && !append && model.trending === null
									? { gifs, page, hasMore }
									: model.trending,
						},
					},
		FailedFetchGifs: ({ requestId }) =>
			requestId !== model.requestId ? { model } : { model: { ...model, isLoading: false, isLoadingMore: false } },
		SucceededFetchCategories: ({ categories: loaded }) => ({ model: { ...model, categories: loaded } }),
		FailedFetchCategories: () => ({ model }),
		// `loadMore`: the next page of the current query, unless one is loading or none is left.
		ScrolledNearEnd: () =>
			model.isLoading || model.isLoadingMore || !model.hasMore || model.gifs.length === 0
				? { model }
				: fetch(model, model.currentQuery, model.page + 1, true),
		HoveredGif: ({ slug }) => ({ model: { ...model, hoveredSlug: slug } }),
		CompletedFocusGifSearch: () => ({ model }),
		ClickedGif: ({ slug }) => {
			const gif = model.gifs.find((candidate) => candidate.slug === slug)
			return gif === undefined
				? { model }
				: { model: { ...model, isOpen: false }, outMessage: OutMessage.SelectedGif({ url: gif.hdGifUrl }) }
		},
	})
