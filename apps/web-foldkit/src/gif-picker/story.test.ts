import { AsyncData } from "foldkit"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { PopoverEvent } from "../picker-popover/popover"
import {
	FetchCategories,
	FetchGifs,
	FocusGifSearch,
	GifResults,
	gifsOf,
	init,
	Message,
	type Model,
	OutMessage,
	searchInputId,
	update,
	WaitForGifSearch,
} from "./picker"

/** `useKlipy`'s calls: trending and categories on open, a debounced search, paging, the HD URL out. */

const gif = (slug: string) => ({
	slug,
	title: slug,
	width: 200,
	height: 100,
	jpgUrl: `https://static.klipy.com/${slug}.jpg`,
	webpUrl: `https://static.klipy.com/${slug}.webp`,
	hdGifUrl: `https://static.klipy.com/${slug}-hd.gif`,
})

const slugs = (current: Model) => gifsOf(current).map((candidate) => candidate.slug)

/** An open picker showing one page of `query`. */
const showing = (
	query: string,
	gifs: ReadonlyArray<ReturnType<typeof gif>>,
	more: Model["more"] = { _tag: "Idle" },
): Model => ({
	...init("gif"),
	isOpen: true,
	query,
	currentQuery: query,
	results: GifResults.Success({ data: { gifs, page: 1 } }),
	more,
})

describe("GIF picker", () => {
	test("opening fetches trending and categories and focuses the search; a search runs after 300ms; a pick sends the HD GIF", () => {
		story(
			update,
			given(init("gif")),
			message(Message.ReceivedPopoverEvent({ event: PopoverEvent.ClickedTrigger() })),
			Command.expectExact(
				FetchGifs({ query: "", page: 1 }),
				FetchCategories(),
				FocusGifSearch({ inputId: searchInputId(init("gif")) }),
			),
			Command.resolve(
				FetchGifs,
				Message.SucceededFetchGifs({ query: "", page: 1, gifs: [gif("wave")], hasMore: true }),
			),
			Command.resolve(FetchCategories, Message.SucceededFetchCategories({ categories: [] })),
			Command.resolve(FocusGifSearch, Message.CompletedFocusGifSearch()),
			message(Message.UpdatedQuery({ query: "cats" })),
			Command.expectExact(WaitForGifSearch({ version: 1 })),
			Command.resolve(WaitForGifSearch, Message.CompletedWaitForGifSearch({ version: 1 })),
			Command.expectExact(FetchGifs({ query: "cats", page: 1 })),
			Command.resolve(
				FetchGifs,
				Message.SucceededFetchGifs({ query: "cats", page: 1, gifs: [gif("cat")], hasMore: false }),
			),
			model((current) => {
				expect(slugs(current)).toEqual(["cat"])
				expect(current.more._tag).toBe("Exhausted")
			}),
			message(Message.ClickedGif({ slug: "cat" })),
			expectOutMessage(OutMessage.SelectedGif({ url: "https://static.klipy.com/cat-hd.gif" })),
			model((current) => expect(current.isOpen).toBe(false)),
		)
	})

	test("clearing the search goes back to the cached trending page without a request", () => {
		story(
			update,
			given({
				...showing("cats", [gif("cat")]),
				trending: { page: { gifs: [gif("wave")], page: 1 }, hasMore: true },
			}),
			message(Message.UpdatedQuery({ query: "" })),
			Command.resolve(WaitForGifSearch, Message.CompletedWaitForGifSearch({ version: 1 })),
			Command.expectNone(),
			model((current) => expect(slugs(current)).toEqual(["wave"])),
		)
	})

	test("a failed first page is an error with a retry, not an empty result", () => {
		story(
			update,
			given({ ...init("gif"), isOpen: true, results: AsyncData.Loading() }),
			message(Message.FailedFetchGifs({ query: "", page: 1, reason: "Offline" })),
			model((current) => {
				expect(current.results).toEqual(GifResults.Failure({ error: "Offline" }))
				expect(gifsOf(current)).toEqual([])
			}),
			message(Message.ClickedRetryFetchGifs()),
			Command.expectExact(FetchGifs({ query: "", page: 1 })),
			model((current) => expect(AsyncData.isLoading(current.results)).toBe(true)),
			Command.resolve(
				FetchGifs,
				Message.SucceededFetchGifs({ query: "", page: 1, gifs: [gif("wave")], hasMore: true }),
			),
			model((current) => expect(slugs(current)).toEqual(["wave"])),
		)
	})

	test("a failed next page keeps the GIFs, stops paging on scroll, and retries from its button", () => {
		story(
			update,
			given(showing("cats", [gif("cat")])),
			message(Message.ScrolledNearEnd()),
			Command.expectExact(FetchGifs({ query: "cats", page: 2 })),
			Command.resolve(
				FetchGifs,
				Message.FailedFetchGifs({ query: "cats", page: 2, reason: "ProviderFailed" }),
			),
			model((current) => {
				expect(current.more).toEqual({ _tag: "Failed", reason: "ProviderFailed" })
				expect(slugs(current)).toEqual(["cat"])
			}),
			message(Message.ScrolledNearEnd()),
			Command.expectNone(),
			message(Message.ClickedRetryFetchGifs()),
			Command.expectExact(FetchGifs({ query: "cats", page: 2 })),
			Command.resolve(
				FetchGifs,
				Message.SucceededFetchGifs({ query: "cats", page: 2, gifs: [gif("kitten")], hasMore: false }),
			),
			model((current) => {
				expect(slugs(current)).toEqual(["cat", "kitten"])
				expect(current.more._tag).toBe("Exhausted")
			}),
		)
	})

	test("results for a query no longer shown are ignored", () => {
		story(
			update,
			given({
				...init("gif"),
				isOpen: true,
				query: "dogs",
				currentQuery: "dogs",
				results: AsyncData.Loading(),
			}),
			message(
				Message.SucceededFetchGifs({ query: "cats", page: 1, gifs: [gif("cat")], hasMore: true }),
			),
			message(Message.FailedFetchGifs({ query: "cats", page: 1, reason: "Offline" })),
			model((current) => expect(AsyncData.isLoading(current.results)).toBe(true)),
			message(
				Message.SucceededFetchGifs({ query: "dogs", page: 1, gifs: [gif("dog")], hasMore: true }),
			),
			// A next page for the old query, landing after the new one, does not append to it.
			message(
				Message.SucceededFetchGifs({ query: "cats", page: 2, gifs: [gif("kitten")], hasMore: true }),
			),
			model((current) => expect(slugs(current)).toEqual(["dog"])),
		)
	})

	test("failed categories are kept as a failure and can be retried", () => {
		story(
			update,
			given({ ...showing("", [gif("wave")]), categories: AsyncData.Loading() }),
			message(Message.FailedFetchCategories({ reason: "Unavailable" })),
			model((current) => expect(AsyncData.getError(current.categories)._tag).toBe("Some")),
			message(Message.ClickedRetryFetchCategories()),
			Command.expectExact(FetchCategories()),
			model((current) => expect(AsyncData.isLoading(current.categories)).toBe(true)),
			Command.resolve(
				FetchCategories,
				Message.SucceededFetchCategories({ categories: [{ category: "Cats", query: "cats" }] }),
			),
			model((current) => expect(AsyncData.getData(current.categories)._tag).toBe("Some")),
		)
	})
})
