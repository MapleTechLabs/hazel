import { Effect, Layer, Option, Schedule, Schema } from "effect"
import { FetchHttpClient, Headers, HttpClient, type HttpClientError, HttpClientResponse } from "effect/http"
import { isRetryableError } from "~/lib/error-messages"

/**
 * frimousse's emoji data (`data/emoji.ts`, `data/emoji-picker.ts`): the emojibase dataset from
 * localStorage (`frimousse/data/<locale>`) or the CDN, filtered to the session's supported emoji
 * version, then searched and chunked into picker rows.
 */

export const EMOJI_FONT_FAMILY =
	"'Apple Color Emoji', 'Noto Color Emoji', 'Twemoji Mozilla', 'Android Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', EmojiSymbols, sans-serif"

const SkinTones = Schema.Struct({
	light: Schema.String,
	"medium-light": Schema.String,
	medium: Schema.String,
	"medium-dark": Schema.String,
	dark: Schema.String,
})
type SkinTones = typeof SkinTones.Type

export const EmojiDataEmoji = Schema.Struct({
	emoji: Schema.String,
	category: Schema.Number,
	label: Schema.String,
	version: Schema.Number,
	tags: Schema.Array(Schema.String),
	countryFlag: Schema.optionalKey(Schema.Boolean),
	skins: Schema.optionalKey(SkinTones),
})
export type EmojiDataEmoji = typeof EmojiDataEmoji.Type

export const EmojiData = Schema.Struct({
	locale: Schema.String,
	emojis: Schema.Array(EmojiDataEmoji),
	categories: Schema.Array(Schema.Struct({ index: Schema.Number, label: Schema.String })),
	skinTones: SkinTones,
})
export type EmojiData = typeof EmojiData.Type

const LocalData = Schema.Struct({
	data: EmojiData,
	metadata: Schema.Struct({
		emojisEtag: Schema.NullOr(Schema.String),
		messagesEtag: Schema.NullOr(Schema.String),
	}),
})

const SessionMetadata = Schema.Struct({ emojiVersion: Schema.Number, countryFlags: Schema.Boolean })
type SessionMetadata = typeof SessionMetadata.Type

const LOCAL_DATA_KEY = (locale: string) => `frimousse/data/${locale}`
const SESSION_METADATA_KEY = "frimousse/metadata"
const BASE_URL = "https://cdn.jsdelivr.net/npm/emojibase-data@latest"

const readStorage = <A>(storage: Storage, key: string, schema: Schema.Codec<A>) =>
	Option.fromNullishOr(storage.getItem(key)).pipe(
		Option.flatMap((item) => Option.liftThrowable(JSON.parse)(item)),
		Option.flatMap(Schema.decodeUnknownOption(schema)),
	)

/** A best-effort cache write: a full or disabled storage only costs the next load a download. */
const writeStorage = (storage: Storage, key: string, value: unknown) =>
	Effect.try(() => storage.setItem(key, JSON.stringify(value))).pipe(Effect.ignore)

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** emojibase's `data.json` entries, as far as the picker reads them. */
const EmojibaseEmoji = Schema.Struct({
	emoji: Schema.String,
	label: Schema.String,
	version: Schema.Number,
	group: Schema.optionalKey(Schema.Number),
	subgroup: Schema.optionalKey(Schema.Number),
	tags: Schema.optionalKey(Schema.Array(Schema.String)),
	skins: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				emoji: Schema.String,
				tone: Schema.optionalKey(Schema.Union([Schema.Number, Schema.Array(Schema.Number)])),
			}),
		),
	),
})
type EmojibaseEmoji = typeof EmojibaseEmoji.Type

/** emojibase's `messages.json`, as far as the picker reads it. */
const EmojibaseMessages = Schema.Struct({
	groups: Schema.Array(Schema.Struct({ key: Schema.String, message: Schema.String, order: Schema.Number })),
	subgroups: Schema.Array(Schema.Struct({ key: Schema.String, order: Schema.Number })),
	skinTones: Schema.Array(Schema.Struct({ key: Schema.String, message: Schema.String })),
})
type EmojibaseMessages = typeof EmojibaseMessages.Type

/** emojibase's tone numbers 1 to 5, in `SkinTones` order. */
const TONES = ["light", "medium-light", "medium", "medium-dark", "dark"] as const

/** The five single-tone variants, or none when emojibase lists fewer. */
const skinsOf = (skins: EmojibaseEmoji["skins"]): Option.Option<SkinTones> => {
	const byTone = new Map(
		(skins ?? []).flatMap((skin) =>
			typeof skin.tone === "number" ? [[skin.tone, skin.emoji] as const] : [],
		),
	)
	const light = byTone.get(1)
	const mediumLight = byTone.get(2)
	const medium = byTone.get(3)
	const mediumDark = byTone.get(4)
	const dark = byTone.get(5)
	return light !== undefined &&
		mediumLight !== undefined &&
		medium !== undefined &&
		mediumDark !== undefined &&
		dark !== undefined
		? Option.some({ light, "medium-light": mediumLight, medium, "medium-dark": mediumDark, dark })
		: Option.none()
}

const skinToneLabels = (messages: EmojibaseMessages): SkinTones => {
	const label = (key: (typeof TONES)[number]) =>
		capitalize(messages.skinTones.find((tone) => tone.key === key)?.message ?? key)
	return {
		light: label("light"),
		"medium-light": label("medium-light"),
		medium: label("medium"),
		"medium-dark": label("medium-dark"),
		dark: label("dark"),
	}
}

/** A CDN JSON file, decoded, with its ETag. Fails with `HttpClientError` (transport, non-2xx) or `SchemaError`. */
const fetchJson = <S extends Schema.Top & { readonly DecodingServices: never }>(url: string, schema: S) =>
	HttpClient.get(url).pipe(
		Effect.flatMap(HttpClientResponse.filterStatusOk),
		Effect.flatMap((response) =>
			HttpClientResponse.schemaBodyJson(schema)(response).pipe(
				Effect.map((json) => ({
					json,
					etag: Option.getOrNull(Headers.get(response.headers, "etag")),
				})),
			),
		),
	)

/** `fetchEmojiData`: download, reshape and cache the dataset. */
const fetchEmojiData = (locale: string) =>
	Effect.gen(function* () {
		const [emojis, messages] = yield* Effect.all(
			[
				fetchJson(`${BASE_URL}/${locale}/data.json`, Schema.Array(EmojibaseEmoji)),
				fetchJson(`${BASE_URL}/${locale}/messages.json`, EmojibaseMessages),
			],
			{ concurrency: 2 },
		)
		const flags = messages.json.subgroups.find(
			(group) => group.key === "country-flag" || group.key === "subdivision-flag",
		)
		const data: EmojiData = {
			locale,
			emojis: emojis.json.flatMap((emoji) =>
				emoji.group === undefined
					? []
					: [
							{
								emoji: emoji.emoji,
								category: emoji.group,
								version: emoji.version,
								label: capitalize(emoji.label),
								tags: [...(emoji.tags ?? [])],
								...(flags && emoji.subgroup === flags.order ? { countryFlag: true } : {}),
								...Option.match(skinsOf(emoji.skins), {
									onNone: () => ({}),
									onSome: (skins) => ({ skins }),
								}),
							},
						],
			),
			categories: messages.json.groups
				.filter((group) => group.key !== "component")
				.map((group) => ({ index: group.order, label: capitalize(group.message) })),
			skinTones: skinToneLabels(messages.json),
		}
		yield* writeStorage(localStorage, LOCAL_DATA_KEY(locale), {
			data,
			metadata: { emojisEtag: emojis.etag, messagesEtag: messages.etag },
		})
		return data
	}).pipe(
		// A dropped connection or a CDN hiccup gets two more tries before the picker shows its error.
		Effect.retry({ times: 2, schedule: Schedule.exponential("300 millis"), while: isRetryableError }),
		// Fresh: the runtime's memoized `FetchHttpClient.layer` sends the RPC client's credentials.
		Effect.provide(Layer.fresh(FetchHttpClient.layer)),
	)

/** `isEmojiSupported`: a color emoji renders the same in two text colors. */
const isEmojiSupported = (emoji: string): boolean => {
	const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
	if (!context) return false
	context.canvas.width = 2
	context.canvas.height = 2
	context.font = `2px ${EMOJI_FONT_FAMILY}`
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

/** `getSessionMetadata`: the newest emoji version this browser renders. */
const sessionMetadataFor = (emojis: ReadonlyArray<EmojiDataEmoji>): SessionMetadata => {
	const firstByVersion = new Map<number, string>()
	for (const emoji of emojis)
		if (!firstByVersion.has(emoji.version)) firstByVersion.set(emoji.version, emoji.emoji)
	const versions = [...firstByVersion.keys()].sort((a, b) => b - a)
	const supported = versions.find((version) => isEmojiSupported(firstByVersion.get(version)!))
	return { emojiVersion: supported ?? versions[0] ?? 0, countryFlags: isEmojiSupported("🇪🇺") }
}

/** `getEmojiData`: cached data when present (ETag checks skipped once per session), else the CDN. */
export const loadEmojiData = (
	locale = "en",
): Effect.Effect<EmojiData, HttpClientError.HttpClientError | Schema.SchemaError> =>
	Effect.gen(function* () {
		const cached = readStorage(localStorage, LOCAL_DATA_KEY(locale), LocalData)
		const data = Option.isSome(cached) ? cached.value.data : yield* fetchEmojiData(locale)
		const metadata = Option.getOrElse(
			readStorage(sessionStorage, SESSION_METADATA_KEY, SessionMetadata),
			() => sessionMetadataFor(data.emojis),
		)
		yield* writeStorage(sessionStorage, SESSION_METADATA_KEY, metadata)
		return {
			...data,
			emojis: data.emojis.filter(
				(emoji) =>
					emoji.version <= metadata.emojiVersion &&
					(emoji.countryFlag !== true || metadata.countryFlags),
			),
		}
	})

// PICKER DATA

export interface PickerEmoji {
	readonly emoji: string
	readonly label: string
}

export interface PickerRow {
	readonly categoryIndex: number
	readonly emojis: ReadonlyArray<PickerEmoji>
}

export interface PickerCategory {
	readonly label: string
	readonly rowsCount: number
	readonly startRowIndex: number
}

export interface PickerData {
	readonly count: number
	readonly categories: ReadonlyArray<PickerCategory>
	readonly categoriesStartRowIndices: ReadonlyArray<number>
	readonly rows: ReadonlyArray<PickerRow>
}

/** `searchEmojis`: label matches score 10, each tag match 1, best first. */
const searchEmojis = (emojis: ReadonlyArray<EmojiDataEmoji>, search: string) => {
	if (!search) return emojis
	const text = search.toLowerCase().trim()
	const scored = emojis.flatMap((emoji) => {
		const score =
			(emoji.label.toLowerCase().includes(text) ? 10 : 0) +
			emoji.tags.filter((tag) => tag.toLowerCase().includes(text)).length
		return score > 0 ? [{ emoji, score }] : []
	})
	return scored.sort((a, b) => b.score - a.score).map(({ emoji }) => emoji)
}

const buildPickerData = (data: EmojiData, columns: number, search: string): PickerData => {
	const emojis = searchEmojis(data.emojis, search)
	const byCategory = new Map<number, Array<PickerEmoji>>()
	for (const emoji of emojis) {
		const list = byCategory.get(emoji.category) ?? []
		list.push({ emoji: emoji.emoji, label: emoji.label })
		byCategory.set(emoji.category, list)
	}
	const rows: Array<PickerRow> = []
	const categories: Array<PickerCategory> = []
	for (const category of data.categories) {
		const list = byCategory.get(category.index)
		if (!list || list.length === 0) continue
		const categoryIndex = categories.length
		const startRowIndex = rows.length
		for (let index = 0; index < list.length; index += columns)
			rows.push({ categoryIndex, emojis: list.slice(index, index + columns) })
		categories.push({ label: category.label, rowsCount: rows.length - startRowIndex, startRowIndex })
	}
	return {
		count: emojis.length,
		categories,
		categoriesStartRowIndices: categories.map((category) => category.startRowIndex),
		rows,
	}
}

/** How many searches each dataset remembers: the open pickers' current ones and a few recent ones. */
const CACHE_SIZE = 8

const cache = new WeakMap<EmojiData, Map<string, PickerData>>()

/** `getEmojiPickerData`, memoized per dataset in a small LRU keyed by columns and search. */
export const pickerDataOf = (data: EmojiData, columns: number, search: string): PickerData => {
	const recent = cache.get(data) ?? new Map<string, PickerData>()
	cache.set(data, recent)
	const key = `${columns}:${search}`
	const hit = recent.get(key)
	recent.delete(key)
	const result = hit ?? buildPickerData(data, columns, search)
	recent.set(key, result)
	if (recent.size > CACHE_SIZE) {
		const oldest = recent.keys().next()
		if (!oldest.done) recent.delete(oldest.value)
	}
	return result
}
