import { Effect, Option, Schema } from "effect"

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
	metadata: Schema.Struct({ emojisEtag: Schema.NullOr(Schema.String), messagesEtag: Schema.NullOr(Schema.String) }),
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

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

interface EmojibaseEmoji {
	readonly emoji: string
	readonly label: string
	readonly version: number
	readonly group?: number
	readonly subgroup?: number
	readonly tags?: ReadonlyArray<string>
	readonly skins?: ReadonlyArray<{ readonly emoji: string; readonly tone?: number | ReadonlyArray<number> }>
}

interface EmojibaseMessages {
	readonly groups: ReadonlyArray<{ readonly key: string; readonly message: string; readonly order: number }>
	readonly subgroups: ReadonlyArray<{ readonly key: string; readonly order: number }>
	readonly skinTones: ReadonlyArray<{ readonly key: string; readonly message: string }>
}

const TONES = ["none", "light", "medium-light", "medium", "medium-dark", "dark"] as const

const fetchJson = <A>(url: string) =>
	Effect.tryPromise(async () => {
		const response = await fetch(url)
		return { json: (await response.json()) as A, etag: response.headers.get("etag") }
	})

/** `fetchEmojiData`: download, reshape and cache the dataset. */
const fetchEmojiData = (locale: string) =>
	Effect.gen(function* () {
		const [emojis, messages] = yield* Effect.all(
			[
				fetchJson<ReadonlyArray<EmojibaseEmoji>>(`${BASE_URL}/${locale}/data.json`),
				fetchJson<EmojibaseMessages>(`${BASE_URL}/${locale}/messages.json`),
			],
			{ concurrency: 2 },
		)
		const flags = messages.json.subgroups.find((group) => group.key === "country-flag" || group.key === "subdivision-flag")
		const data: EmojiData = {
			locale,
			emojis: emojis.json
				.filter((emoji) => emoji.group !== undefined)
				.map((emoji) => {
					const skins = (emoji.skins ?? []).filter((skin) => typeof skin.tone === "number")
					return {
						emoji: emoji.emoji,
						category: emoji.group ?? 0,
						version: emoji.version,
						label: capitalize(emoji.label),
						tags: [...(emoji.tags ?? [])],
						...(flags && emoji.subgroup === flags.order ? { countryFlag: true } : {}),
						...(skins.length > 0
							? {
									skins: Object.fromEntries(
										skins.map((skin) => [TONES[skin.tone as number], skin.emoji]),
									) as EmojiData["skinTones"],
								}
							: {}),
					}
				}),
			categories: messages.json.groups
				.filter((group) => group.key !== "component")
				.map((group) => ({ index: group.order, label: capitalize(group.message) })),
			skinTones: Object.fromEntries(
				messages.json.skinTones.map((tone) => [tone.key, capitalize(tone.message)]),
			) as EmojiData["skinTones"],
		}
		localStorage.setItem(
			LOCAL_DATA_KEY(locale),
			JSON.stringify({ data, metadata: { emojisEtag: emojis.etag, messagesEtag: messages.etag } }),
		)
		return data
	})

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
	for (const emoji of emojis) if (!firstByVersion.has(emoji.version)) firstByVersion.set(emoji.version, emoji.emoji)
	const versions = [...firstByVersion.keys()].sort((a, b) => b - a)
	const supported = versions.find((version) => isEmojiSupported(firstByVersion.get(version)!))
	return { emojiVersion: supported ?? versions[0] ?? 0, countryFlags: isEmojiSupported("🇪🇺") }
}

/** `getEmojiData`: cached data when present (ETag checks skipped once per session), else the CDN. */
export const loadEmojiData = (locale = "en"): Effect.Effect<EmojiData, unknown> =>
	Effect.gen(function* () {
		const cached = readStorage(localStorage, LOCAL_DATA_KEY(locale), LocalData)
		const data = Option.isSome(cached) ? cached.value.data : yield* fetchEmojiData(locale)
		const metadata = Option.getOrElse(readStorage(sessionStorage, SESSION_METADATA_KEY, SessionMetadata), () =>
			sessionMetadataFor(data.emojis),
		)
		sessionStorage.setItem(SESSION_METADATA_KEY, JSON.stringify(metadata))
		return {
			...data,
			emojis: data.emojis.filter(
				(emoji) =>
					emoji.version <= metadata.emojiVersion && (emoji.countryFlag !== true || metadata.countryFlags),
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

const cache = new WeakMap<EmojiData, Map<string, PickerData>>()

/** `getEmojiPickerData`, memoized per dataset and search. */
export const pickerDataOf = (data: EmojiData, columns: number, search: string): PickerData => {
	const bySearch = cache.get(data) ?? new Map<string, PickerData>()
	cache.set(data, bySearch)
	const hit = bySearch.get(search)
	if (hit) return hit
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
	const result = {
		count: emojis.length,
		categories,
		categoriesStartRowIndices: categories.map((category) => category.startRowIndex),
		rows,
	}
	bySearch.set(search, result)
	return result
}
