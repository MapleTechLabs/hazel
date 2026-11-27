// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The emoji picker's dataset (today's `web-foldkit/src/emoji-picker/data.ts`, frimousse's): emojibase
 * from the CDN, cached under frimousse's keys, filtered to what this device draws, then grouped into
 * the categories `hz:emojiPicker` shows, with the recently used ones first.
 */
import { Query } from "@effect/ui"
import { KeyValue } from "@hazel/client-data"
import { Effect, Option, Schedule, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import type { RecentEmoji } from "./recent"

const SkinTones = Schema.Struct({
	light: Schema.String,
	"medium-light": Schema.String,
	medium: Schema.String,
	"medium-dark": Schema.String,
	dark: Schema.String,
})
export type SkinTones = typeof SkinTones.Type
export type SkinTone = keyof SkinTones

export const EmojiDataEmoji = Schema.Struct({
	emoji: Schema.String,
	category: Schema.Finite,
	label: Schema.String,
	version: Schema.Finite,
	tags: Schema.Array(Schema.String),
	countryFlag: Schema.optionalKey(Schema.Boolean),
	skins: Schema.optionalKey(SkinTones),
})
export type EmojiDataEmoji = typeof EmojiDataEmoji.Type

export const EmojiData = Schema.Struct({
	locale: Schema.String,
	emojis: Schema.Array(EmojiDataEmoji),
	categories: Schema.Array(Schema.Struct({ index: Schema.Finite, label: Schema.String })),
	skinTones: SkinTones,
})
export type EmojiData = typeof EmojiData.Type

/** The dataset could not load: the CDN failed or sent something else. */
export const EmojiDataFailure = Schema.Literals(["Unavailable"])
export type EmojiDataFailure = typeof EmojiDataFailure.Type

/** What `hz:emojiPicker` draws (`@hazel/ui/web/primitives/overlays/emoji-data.ts`'s shape). */
export interface PickerEmoji {
	readonly emoji: string
	readonly name: string
}
export interface PickerCategory {
	readonly label: string
	readonly emojis: ReadonlyArray<PickerEmoji>
}

export const RECENT_CATEGORY_LABEL = "Recently used"

const LOCAL_DATA_KEY = (locale: string) => `frimousse/data/${locale}`
const BASE_URL = "https://cdn.jsdelivr.net/npm/emojibase-data@latest"
const TONES = ["light", "medium-light", "medium", "medium-dark", "dark"] as const

const LocalData = Schema.Struct({ data: EmojiData })
interface SessionMetadata {
	readonly emojiVersion: number
	readonly countryFlags: boolean
}

const EmojibaseEmoji = Schema.Struct({
	emoji: Schema.String,
	label: Schema.String,
	version: Schema.Finite,
	group: Schema.optionalKey(Schema.Finite),
	subgroup: Schema.optionalKey(Schema.Finite),
	tags: Schema.optionalKey(Schema.Array(Schema.String)),
	skins: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				emoji: Schema.String,
				tone: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.Array(Schema.Finite)])),
			}),
		),
	),
})
type EmojibaseEmoji = typeof EmojibaseEmoji.Type

const EmojibaseMessages = Schema.Struct({
	groups: Schema.Array(Schema.Struct({ key: Schema.String, message: Schema.String, order: Schema.Finite })),
	subgroups: Schema.Array(Schema.Struct({ key: Schema.String, order: Schema.Finite })),
	skinTones: Schema.Array(Schema.Struct({ key: Schema.String, message: Schema.String })),
})

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const decodeJson = <A>(schema: Schema.Codec<A>, text: string | null): Option.Option<A> =>
	Option.fromNullishOr(text).pipe(
		Option.flatMap((item) => Option.liftThrowable(JSON.parse)(item)),
		Option.flatMap(Schema.decodeUnknownOption(schema)),
	)

/** The five single-tone variants, or none when emojibase lists fewer. */
const skinsOf = (skins: EmojibaseEmoji["skins"]): SkinTones | undefined => {
	const byTone = new Map(
		(skins ?? []).flatMap((skin) =>
			typeof skin.tone === "number" ? [[skin.tone, skin.emoji] as const] : [],
		),
	)
	const [light, mediumLight, medium, mediumDark, dark] = [1, 2, 3, 4, 5].map((tone) => byTone.get(tone))
	return light && mediumLight && medium && mediumDark && dark
		? { light, "medium-light": mediumLight, medium, "medium-dark": mediumDark, dark }
		: undefined
}

/** Reshapes emojibase's `data.json` and `messages.json` into the picker's dataset. */
export const toEmojiData = (
	locale: string,
	emojis: ReadonlyArray<EmojibaseEmoji>,
	messages: typeof EmojibaseMessages.Type,
): EmojiData => {
	const flags = messages.subgroups.find(
		(group) => group.key === "country-flag" || group.key === "subdivision-flag",
	)
	const toneLabel = (key: SkinTone) =>
		capitalize(messages.skinTones.find((tone) => tone.key === key)?.message ?? key)
	return {
		locale,
		emojis: emojis.flatMap((emoji) => {
			if (emoji.group === undefined) return []
			const base: EmojiDataEmoji = {
				emoji: emoji.emoji,
				category: emoji.group,
				version: emoji.version,
				label: capitalize(emoji.label),
				tags: [...(emoji.tags ?? [])],
			}
			const flagged: EmojiDataEmoji =
				flags && emoji.subgroup === flags.order ? { ...base, countryFlag: true } : base
			const skins = skinsOf(emoji.skins)
			return [skins === undefined ? flagged : { ...flagged, skins }]
		}),
		categories: messages.groups
			.filter((group) => group.key !== "component")
			.map((group) => ({ index: group.order, label: capitalize(group.message) })),
		skinTones: {
			light: toneLabel("light"),
			"medium-light": toneLabel("medium-light"),
			medium: toneLabel("medium"),
			"medium-dark": toneLabel("medium-dark"),
			dark: toneLabel("dark"),
		},
	}
}

/** A color emoji paints the same in two text colours; without a canvas every emoji counts. */
const isEmojiSupported = (emoji: string): boolean => {
	if (typeof document === "undefined") return true
	const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
	if (!context) return true
	context.canvas.width = 2
	context.canvas.height = 2
	context.font = "2px 'Apple Color Emoji', 'Noto Color Emoji', 'Segoe UI Emoji', sans-serif"
	context.textBaseline = "middle"
	if (context.measureText(emoji).width >= 4) return false
	const paint = (color: string) => {
		context.clearRect(0, 0, 2, 2)
		context.fillStyle = color
		context.fillText(emoji, 0, 0)
		return context.getImageData(0, 0, 2, 2).data
	}
	const blue = paint("#00f")
	const red = paint("#f00")
	return blue.every((value, index) => index % 4 === 3 || value === red[index])
}

/** The newest emoji version this device draws, probed once per version. */
const sessionMetadataFor = (emojis: ReadonlyArray<EmojiDataEmoji>): SessionMetadata => {
	const firstByVersion = new Map<number, string>()
	for (const emoji of emojis)
		if (!firstByVersion.has(emoji.version)) firstByVersion.set(emoji.version, emoji.emoji)
	const versions = [...firstByVersion.keys()].sort((a, b) => b - a)
	const supported = versions.find((version) => isEmojiSupported(firstByVersion.get(version) ?? ""))
	return { emojiVersion: supported ?? versions[0] ?? 0, countryFlags: isEmojiSupported("🇪🇺") }
}

/** Keeps the emoji this device draws (frimousse's session metadata). */
export const supportedOnly = (data: EmojiData, metadata: SessionMetadata): EmojiData => ({
	...data,
	emojis: data.emojis.filter(
		(emoji) =>
			emoji.version <= metadata.emojiVersion && (emoji.countryFlag !== true || metadata.countryFlags),
	),
})

/**
 * The picker's categories: the recently used first, then the dataset's. `tone` swaps in an emoji's
 * skin tone variant where it has one.
 */
export const categoriesOf = (
	data: EmojiData,
	recent: ReadonlyArray<RecentEmoji>,
	tone: SkinTone | null = null,
): ReadonlyArray<PickerCategory> => {
	const labels = new Map(data.emojis.map((emoji) => [emoji.emoji, emoji.label]))
	const byCategory = new Map<number, Array<PickerEmoji>>()
	for (const emoji of data.emojis) {
		const list = byCategory.get(emoji.category) ?? []
		list.push({
			emoji: tone === null ? emoji.emoji : (emoji.skins?.[tone] ?? emoji.emoji),
			name: emoji.label,
		})
		byCategory.set(emoji.category, list)
	}
	// HAZEL-GAP(emoji-picker-custom): a custom emoji draws as an image; the picker takes text only.
	const recents = recent
		.filter((entry) => entry.imageUrl === null)
		.map((entry) => ({ emoji: entry.emoji, name: labels.get(entry.emoji) ?? entry.label }))
	const categories = data.categories.flatMap((category) => {
		const emojis = byCategory.get(category.index) ?? []
		return emojis.length === 0 ? [] : [{ label: category.label, emojis }]
	})
	return recents.length === 0
		? categories
		: [{ label: RECENT_CATEGORY_LABEL, emojis: recents }, ...categories]
}

/**
 * The dataset: localStorage's copy when present, else the CDN's (cached for next time), filtered
 * to what this device draws. One fetch per app run; the picker's instances share it.
 */
export class LoadEmojiData extends Query.Service<LoadEmojiData>()("hazel/pickers/LoadEmojiData", {
	args: { locale: Schema.String },
	success: EmojiData,
	error: EmojiDataFailure,
	staleTime: "Infinity",
}) {
	/** Needs `KeyValue` (the cache) and an `HttpClient` (the CDN). */
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const store = yield* KeyValue
			const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
			const fetchJson = <S extends Schema.Top & { readonly DecodingServices: never }>(
				url: string,
				schema: S,
			) => client.get(url).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)))
			const download = (locale: string) =>
				Effect.all(
					[
						fetchJson(`${BASE_URL}/${locale}/data.json`, Schema.Array(EmojibaseEmoji)),
						fetchJson(`${BASE_URL}/${locale}/messages.json`, EmojibaseMessages),
					],
					{ concurrency: 2 },
				).pipe(
					Effect.map(([emojis, messages]) => toEmojiData(locale, emojis, messages)),
					Effect.tap((data) =>
						Effect.sync(() =>
							store.set(
								LOCAL_DATA_KEY(locale),
								JSON.stringify({ data, metadata: { emojisEtag: null, messagesEtag: null } }),
							),
						),
					),
					// A dropped connection or a CDN hiccup gets two more tries.
					Effect.retry({ times: 2, schedule: Schedule.exponential("300 millis") }),
				)
			return ({ locale }) =>
				Effect.gen(function* () {
					const cached = decodeJson(LocalData, store.get(LOCAL_DATA_KEY(locale)))
					const data = Option.isSome(cached) ? cached.value.data : yield* download(locale)
					// Probed once per run (the query is cached), so a browser update is noticed.
					return supportedOnly(data, sessionMetadataFor(data.emojis))
				}).pipe(
					// BOUNDARY: every transport or decode failure reads the same: the built-in set stays.
					Effect.tapCause((cause) => Effect.logWarning("emoji data failed to load", cause)),
					Effect.mapError((): EmojiDataFailure => "Unavailable"),
				)
		}),
	)
}
