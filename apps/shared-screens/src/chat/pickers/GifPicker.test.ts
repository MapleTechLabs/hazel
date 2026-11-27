// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Query } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import {
	failureText,
	type Gif,
	GifPicker,
	GifPickerEvents,
	GifPickerMessage,
	pageStream,
	SearchGifs,
} from "./GifPicker"

const gif = (name: string): Gif => ({
	url: `https://gif/${name}-hd.gif`,
	still: `https://gif/${name}.jpg`,
	animated: `https://gif/${name}.webp`,
	title: name,
	width: 200,
	height: 150,
})
const cat = gif("cat")
const dog = gif("dog")

const extension = Locator.tag("hz:ext")
const open = () => Scene.start(GifPicker, { open: true })
const argsOf = (s: ReturnType<typeof open>) =>
	s.get(extension).props?.["args"] as Record<string, unknown> | undefined

describe("GIF picker", () => {
	it("opens on trending: a spinner, then the first page and the chips", () => {
		const s = open()
		assert.strictEqual(argsOf(s)?.["status"], "loading")
		s.subscription(
			'page:"",1,0',
			GifPickerMessage.LoadedPage({ search: "", page: 1, result: { gifs: [cat], hasNext: true } }),
		)
		s.subscription(
			"categories:0",
			GifPickerMessage.LoadedCategories({ categories: [{ label: "Happy", query: "happy" }] }),
		)
		const args = argsOf(s)
		assert.strictEqual(args?.["status"], "ready")
		assert.deepStrictEqual(args?.["gifs"], [cat])
		assert.deepStrictEqual(args?.["categories"], [{ label: "Happy", query: "happy" }])
		assert.strictEqual(args?.["paging"], "idle")
	})

	it("pages on reachEnd, appending, until there are no more", () => {
		const s = open()
		s.subscription(
			'page:"",1,0',
			GifPickerMessage.LoadedPage({ search: "", page: 1, result: { gifs: [cat], hasNext: true } }),
		)
		s.fire(extension, "reachEnd", {})
		assert.strictEqual(argsOf(s)?.["paging"], "loading")
		s.subscription(
			'page:"",2,0',
			GifPickerMessage.LoadedPage({ search: "", page: 2, result: { gifs: [dog], hasNext: false } }),
		)
		assert.deepStrictEqual(argsOf(s)?.["gifs"], [cat, dog])
		assert.strictEqual(argsOf(s)?.["paging"], "done")
	})

	it("a chip searches its query; a stale page is dropped; a failure says why and retries", () => {
		const s = open()
		s.fire(extension, "category", { query: "happy" })
		assert.strictEqual(argsOf(s)?.["category"], "happy")
		s.subscription(
			'page:"happy",1,0',
			GifPickerMessage.LoadedPage({ search: "", page: 1, result: { gifs: [cat], hasNext: false } }),
		)
		assert.deepStrictEqual(argsOf(s)?.["gifs"], [])
		s.subscription(
			'page:"happy",1,0',
			GifPickerMessage.FailedPage({ search: "happy", page: 1, reason: "ProviderFailed" }),
		)
		assert.strictEqual(argsOf(s)?.["status"], "failed")
		assert.deepStrictEqual(argsOf(s)?.["failure"], failureText("ProviderFailed"))
		s.fire(extension, "retry", {})
		assert.strictEqual(argsOf(s)?.["status"], "loading")
		s.fire(extension, "query", { text: "dog" })
		assert.strictEqual(argsOf(s)?.["category"], undefined)
	})

	it("a pick reports the GIF's URL; Escape or a press outside asks to close", () => {
		Scene.start(GifPicker, { open: true })
			.fire(extension, "select", { url: cat.url })
			.emitted(GifPickerEvents.Picked({ url: cat.url }))
			.fire(extension, "dismiss", {})
			.emitted(GifPickerEvents.RequestedClose())
	})

	it.effect("asks the provider for the page", () =>
		Effect.gen(function* () {
			const asked: Array<string> = []
			const services = Layer.mergeAll(
				SearchGifs.toLayer(({ query, page }) =>
					Effect.sync(() => {
						asked.push(`${query}#${page}`)
						return { gifs: [cat], hasNext: false }
					}),
				),
				Query.layer(),
			)
			const message = yield* Stream.runHead(pageStream("cats", 2)).pipe(Effect.provide(services))
			assert.deepStrictEqual(
				message._tag === "Some" ? message.value : null,
				GifPickerMessage.LoadedPage({
					search: "cats",
					page: 2,
					result: { gifs: [cat], hasNext: false },
				}),
			)
			assert.deepStrictEqual(asked, ["cats#2"])
		}),
	)
})
