// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Query } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { type GifSearch, PickerCatalog } from "./catalog"
import {
	connectStream,
	type Gif,
	GifPicker,
	GifPickerEvents,
	GifPickerMessage,
	SearchGifs,
} from "./GifPicker"

const cat: Gif = { url: "https://gif/cat-hd.gif", preview: "https://gif/cat.jpg", title: "Cat" }

const extension = Locator.tag("hz:ext")

const searches: Array<GifSearch | undefined> = []
const asked: Array<string> = []
const services = () =>
	Layer.mergeAll(
		Layer.succeed(PickerCatalog, {
			showEmoji: () => Effect.void,
			showGifs: (search) => Effect.sync(() => void searches.push(search)),
		}),
		SearchGifs.toLayer(({ query }) =>
			Effect.sync(() => {
				asked.push(query)
				return query === "" ? [cat] : []
			}),
		),
		Query.layer(),
	)

describe("GIF picker", () => {
	it("draws the web extension the parent opens; a pick reports the GIF's URL", () => {
		const s = Scene.start(GifPicker, { open: true })
		assert.deepStrictEqual(s.get(extension).props, { ext: "GifPicker", args: { open: true } })
		s.fire(extension, "select", { url: cat.url }).emitted(GifPickerEvents.Picked({ url: cat.url }))
	})

	it("Escape or a press outside asks the parent to close it", () => {
		Scene.start(GifPicker, { open: true })
			.fire(extension, "dismiss", {})
			.emitted(GifPickerEvents.RequestedClose())
	})

	it.effect("searches through the provider query, trending once, and disconnects on unmount", () =>
		Effect.gen(function* () {
			const first = yield* Stream.runHead(connectStream)
			assert.deepStrictEqual(
				first._tag === "Some" ? first.value : null,
				GifPickerMessage.ConnectedGifSearch(),
			)
			const search = searches[0]
			assert.isDefined(search)
			const signal = new AbortController().signal
			const trending = yield* Effect.promise(() => search!("", signal))
			yield* Effect.promise(() => search!("", signal))
			const none = yield* Effect.promise(() => search!("zzz", signal))
			assert.deepStrictEqual(trending, [cat])
			assert.deepStrictEqual(none, [])
			assert.deepStrictEqual(asked, ["", "zzz"])
			// `runHead` ends the stream after the first message: the picker is disconnected.
			assert.strictEqual(searches.at(-1), undefined)
		}).pipe(Effect.provide(services())),
	)
})
