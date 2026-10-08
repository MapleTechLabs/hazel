import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { PopoverEvent } from "../picker-popover/popover"
import { FetchCategories, FetchGifs, init, Message, OutMessage, update, WaitForGifSearch } from "./picker"

/** `useKlipy`'s calls: trending and categories on open, a debounced search, the HD URL out. */

const gif = (slug: string) => ({
	slug,
	title: slug,
	width: 200,
	height: 100,
	jpgUrl: `https://static.klipy.com/${slug}.jpg`,
	webpUrl: `https://static.klipy.com/${slug}.webp`,
	hdGifUrl: `https://static.klipy.com/${slug}-hd.gif`,
})

describe("GIF picker", () => {
	test("opening fetches trending and categories; a search runs after 300ms; a pick sends the HD GIF", () => {
		story(
			update,
			given(init("gif")),
			message(Message.GotPopoverEvent({ event: PopoverEvent.ClickedTrigger() })),
			Command.expectExact(FetchGifs({ query: "", page: 1, append: false, requestId: 1 }), FetchCategories()),
			Command.resolve(
				FetchGifs,
				Message.SucceededFetchGifs({ requestId: 1, append: false, gifs: [gif("wave")], page: 1, hasMore: true }),
			),
			Command.resolve(FetchCategories, Message.SucceededFetchCategories({ categories: [] })),
			message(Message.UpdatedQuery({ query: "cats" })),
			Command.expectExact(WaitForGifSearch({ version: 1 })),
			Command.resolve(WaitForGifSearch, Message.CompletedWaitForGifSearch({ version: 1 })),
			Command.expectExact(FetchGifs({ query: "cats", page: 1, append: false, requestId: 2 })),
			Command.resolve(
				FetchGifs,
				Message.SucceededFetchGifs({ requestId: 2, append: false, gifs: [gif("cat")], page: 1, hasMore: false }),
			),
			model((current) => expect(current.gifs.map((candidate) => candidate.slug)).toEqual(["cat"])),
			message(Message.ClickedGif({ slug: "cat" })),
			expectOutMessage(OutMessage.SelectedGif({ url: "https://static.klipy.com/cat-hd.gif" })),
			model((current) => expect(current.isOpen).toBe(false)),
		)
	})

	test("clearing the search goes back to the cached trending page without a request", () => {
		story(
			update,
			given({ ...init("gif"), isOpen: true, query: "cats", currentQuery: "cats", gifs: [gif("cat")], trending: { gifs: [gif("wave")], page: 1, hasMore: true } }),
			message(Message.UpdatedQuery({ query: "" })),
			Command.resolve(WaitForGifSearch, Message.CompletedWaitForGifSearch({ version: 1 })),
			Command.expectNone(),
			model((current) => expect(current.gifs.map((candidate) => candidate.slug)).toEqual(["wave"])),
		)
	})
})
