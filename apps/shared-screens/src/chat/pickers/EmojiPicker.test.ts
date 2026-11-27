// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component, Query } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { KeyValue } from "@hazel/client-data"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import {
	categoriesOf,
	CUSTOM_CATEGORY_LABEL,
	type EmojiData,
	LoadEmojiData,
	RECENT_CATEGORY_LABEL,
} from "./emoji-data"
import {
	catalogStream,
	EMOJI_LOAD_FAILED,
	EmojiPickerEvents,
	EmojiPickerMessage,
	EmojiPickerNoDeps,
	SaveRecentEmojis,
} from "./EmojiPicker"
import { decodeRecentEmojis, MAX_RECENT_EMOJIS, type RecentEmoji, withRecentEmoji } from "./recent"

const data: EmojiData = {
	locale: "en",
	emojis: [
		{ emoji: "😀", category: 0, label: "Grinning face", version: 1, tags: ["smile"] },
		{
			emoji: "👍",
			category: 1,
			label: "Thumbs up",
			version: 0.6,
			tags: ["yes"],
			skins: { light: "👍🏻", "medium-light": "👍🏼", medium: "👍🏽", "medium-dark": "👍🏾", dark: "👍🏿" },
		},
	],
	categories: [
		{ index: 0, label: "Smileys & emotion" },
		{ index: 1, label: "People & body" },
		{ index: 2, label: "Flags" },
	],
	skinTones: {
		light: "Light",
		"medium-light": "Medium-light",
		medium: "Medium",
		"medium-dark": "Medium-dark",
		dark: "Dark",
	},
}

const recent = (emoji: string): RecentEmoji => ({ emoji, label: "", imageUrl: null })

const picker = Locator.tag("hz:emojiPicker")

/** A `KeyValue` over a Map, seeded with `entries`. */
const memoryStore = (entries: ReadonlyArray<readonly [string, string]> = []) => {
	const map = new Map(entries)
	return {
		map,
		layer: Layer.succeed(KeyValue, {
			get: (key) => map.get(key) ?? null,
			set: (key, value) => void map.set(key, value),
			remove: (key) => void map.delete(key),
		}),
	}
}

describe("emoji picker", () => {
	it("draws the picker the parent opens", () => {
		const closed = Scene.start(EmojiPickerNoDeps, { open: false })
		assert.strictEqual(closed.get(picker).props?.["open"], undefined)
		const open = Scene.start(EmojiPickerNoDeps, { open: true })
		assert.strictEqual(open.get(picker).props?.["open"], true)
	})

	it("a pick is reported and remembered first, without repeats", () => {
		Scene.start(EmojiPickerNoDeps, { open: true })
			.subscription(
				"recent:",
				EmojiPickerMessage.LoadedRecentEmojis({ recent: [recent("😀"), recent("👍")] }),
			)
			.fire(picker, "select", { emoji: "👍" })
			.expectExact(SaveRecentEmojis.make({ recent: [recent("👍"), recent("😀")] }))
			.emitted(EmojiPickerEvents.Picked({ emoji: "👍" }))
			.resolve(SaveRecentEmojis, Component.noop)
	})

	it("Escape or a press outside asks the parent to close it", () => {
		Scene.start(EmojiPickerNoDeps, { open: true })
			.fire(picker, "dismiss")
			.emitted(EmojiPickerEvents.RequestedClose())
	})

	it.effect("loads the full set into the model", () =>
		Effect.gen(function* () {
			const message = yield* Stream.runHead(catalogStream).pipe(
				Effect.provide(
					Layer.mergeAll(
						LoadEmojiData.toLayer(() => Effect.succeed(data)),
						Query.layer(),
					),
				),
			)
			assert.deepStrictEqual(
				message._tag === "Some" ? message.value : null,
				EmojiPickerMessage.LoadedEmojiData({ data }),
			)
		}),
	)

	it.effect("a failed load reports it", () =>
		Effect.gen(function* () {
			const message = yield* Stream.runHead(catalogStream).pipe(
				Effect.provide(
					Layer.mergeAll(
						LoadEmojiData.toLayer(() => Effect.fail("Unavailable" as const)),
						Query.layer(),
					),
				),
			)
			assert.deepStrictEqual(
				message._tag === "Some" ? message.value : null,
				EmojiPickerMessage.FailedLoadEmojiData(),
			)
		}),
	)

	it("passes the set as categories: a spinner first, then the recently used and the custom ones", () => {
		const s = Scene.start(EmojiPickerNoDeps, {
			open: true,
			custom: [{ name: "parrot", imageUrl: "https://cdn/p.png" }],
		})
		assert.strictEqual(s.get(picker).props?.["loading"], true)
		s.subscription("recent:", EmojiPickerMessage.LoadedRecentEmojis({ recent: [recent("👍")] }))
		s.subscription("catalog:0", EmojiPickerMessage.LoadedEmojiData({ data }))
		const props = s.get(picker).props
		assert.strictEqual(props?.["loading"], undefined)
		const categories = props?.["categories"] as ReadonlyArray<{ label: string }>
		assert.deepStrictEqual(
			categories.map((category) => category.label),
			[RECENT_CATEGORY_LABEL, CUSTOM_CATEGORY_LABEL, "Smileys & emotion", "People & body"],
		)
	})

	it("a failure shows its reason, and Try again loads anew", () => {
		const s = Scene.start(EmojiPickerNoDeps, { open: true })
		s.subscription("catalog:0", EmojiPickerMessage.FailedLoadEmojiData())
		assert.strictEqual(s.get(picker).props?.["error"], EMOJI_LOAD_FAILED)
		s.fire(picker, "retry")
		assert.strictEqual(s.get(picker).props?.["loading"], true)
		assert.strictEqual(s.get(picker).props?.["error"], undefined)
	})

	it("a custom pick is remembered with its image", () => {
		Scene.start(EmojiPickerNoDeps, {
			open: true,
			custom: [{ name: "parrot", imageUrl: "https://cdn/p.png" }],
		})
			.subscription("recent:", EmojiPickerMessage.LoadedRecentEmojis({ recent: [] }))
			.fire(picker, "select", { emoji: ":parrot:" })
			.expectExact(
				SaveRecentEmojis.make({
					recent: [{ emoji: ":parrot:", label: "parrot", imageUrl: "https://cdn/p.png" }],
				}),
			)
			.emitted(EmojiPickerEvents.Picked({ emoji: ":parrot:" }))
			.resolve(SaveRecentEmojis, Component.noop)
	})

	it.effect("the dataset comes from the cache without a download", () =>
		Effect.gen(function* () {
			const store = memoryStore([["frimousse/data/en", JSON.stringify({ data })]])
			const noNetwork = Layer.succeed(
				HttpClient.HttpClient,
				HttpClient.make(() => Effect.die("no request expected")),
			)
			const loaded = yield* LoadEmojiData.get({ locale: "en" }).pipe(
				Effect.provide(
					Layer.mergeAll(LoadEmojiData.layer, Query.layer()).pipe(
						Layer.provide(Layer.mergeAll(store.layer, noNetwork)),
					),
				),
			)
			assert.deepStrictEqual(
				loaded.emojis.map((emoji) => emoji.emoji),
				["😀", "👍"],
			)
		}),
	)

	it.effect("a first load downloads emojibase and caches it", () =>
		Effect.gen(function* () {
			const store = memoryStore()
			const json = (url: string) =>
				url.endsWith("data.json")
					? [
							{
								emoji: "😀",
								label: "grinning face",
								version: 1,
								group: 0,
								subgroup: 0,
								tags: ["smile"],
							},
						]
					: {
							groups: [{ key: "smileys-emotion", message: "smileys & emotion", order: 0 }],
							subgroups: [],
							skinTones: [],
						}
			const cdn = Layer.succeed(
				HttpClient.HttpClient,
				HttpClient.make((request) =>
					Effect.succeed(
						HttpClientResponse.fromWeb(request, new Response(JSON.stringify(json(request.url)))),
					),
				),
			)
			const loaded = yield* LoadEmojiData.get({ locale: "en" }).pipe(
				Effect.provide(
					Layer.mergeAll(LoadEmojiData.layer, Query.layer()).pipe(
						Layer.provide(Layer.mergeAll(store.layer, cdn)),
					),
				),
			)
			assert.deepStrictEqual(loaded.categories, [{ index: 0, label: "Smileys & emotion" }])
			assert.deepStrictEqual(
				loaded.emojis.map((emoji) => emoji.label),
				["Grinning face"],
			)
			assert.isTrue(store.map.has("frimousse/data/en"))
		}),
	)
})

describe("emoji picker data", () => {
	it("swaps in a skin tone where an emoji has one, with its tags for search", () => {
		const people = categoriesOf(data, [], "dark").find((category) => category.label === "People & body")
		assert.deepStrictEqual(people?.emojis, [{ emoji: "👍🏿", name: "Thumbs up", keywords: ["yes"] }])
	})

	it("keeps a recent custom emoji's image, and names a remembered one from the set", () => {
		const [first] = categoriesOf(data, [
			{ emoji: ":parrot:", label: "parrot", imageUrl: "https://cdn/p.png" },
			recent("👍"),
			recent("🦄"),
		])
		assert.strictEqual(first?.label, RECENT_CATEGORY_LABEL)
		assert.strictEqual(first?.recent, true)
		assert.deepStrictEqual(first?.emojis, [
			{ emoji: ":parrot:", name: "parrot", image: "https://cdn/p.png" },
			{ emoji: "👍", name: "Thumbs up" },
			{ emoji: "🦄", name: "" },
		])
	})

	it("remembers at most two rows, newest first", () => {
		const many = Array.from({ length: MAX_RECENT_EMOJIS }, (_, index) => recent(`e${index}`))
		const next = withRecentEmoji(many, recent("new"))
		assert.strictEqual(next.length, MAX_RECENT_EMOJIS)
		assert.strictEqual(next[0]?.emoji, "new")
	})

	it("an unreadable store has no recent emojis", () => {
		assert.deepStrictEqual(decodeRecentEmojis("not json"), [])
		assert.deepStrictEqual(decodeRecentEmojis(null), [])
	})
})
