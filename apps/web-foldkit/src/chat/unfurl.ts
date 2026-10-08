import { Effect, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"
import { Command } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"

/**
 * URL unfurls fetched from the link-preview worker (legacy `LinkPreviewClient`, base URL
 * `https://link-preview.hazel.sh`): `LinkPreview`'s Open Graph data and `TweetEmbed`'s tweet.
 */

const LINK_PREVIEW_URL = "https://link-preview.hazel.sh"

// MODEL

/** The worker's `LinkPreviewData`; every field is optional. */
export const LinkPreviewData = Schema.Struct({
	url: Schema.optionalKey(Schema.String),
	title: Schema.optionalKey(Schema.String),
	description: Schema.optionalKey(Schema.String),
	image: Schema.optionalKey(Schema.Struct({ url: Schema.optionalKey(Schema.String) })),
})
export type LinkPreviewData = typeof LinkPreviewData.Type

/** `getEntities` output: a run of tweet text, or a link (`href`) for urls, hashtags, mentions, symbols. */
export const TweetEntity = Schema.Struct({
	type: Schema.Literals(["text", "url", "hashtag", "mention", "symbol", "media"]),
	text: Schema.String,
	href: Schema.NullOr(Schema.String),
})
export type TweetEntity = typeof TweetEntity.Type

/** What `TweetEmbed` reads from `enrichTweet(tweet)`; null metrics were absent from the response. */
export const TweetView = Schema.Struct({
	url: Schema.String,
	text: Schema.String,
	user: Schema.Struct({
		name: Schema.String,
		screenName: Schema.String,
		url: Schema.String,
		avatarUrl: Schema.String,
		isVerified: Schema.Boolean,
	}),
	entities: Schema.Array(TweetEntity),
	photos: Schema.NullOr(Schema.Array(Schema.Struct({ url: Schema.String, width: Schema.Number, height: Schema.Number }))),
	video: Schema.NullOr(Schema.Struct({ poster: Schema.String, src: Schema.NullOr(Schema.String) })),
	favoriteCount: Schema.NullOr(Schema.Number),
	replyCount: Schema.NullOr(Schema.Number),
	retweetCount: Schema.NullOr(Schema.Number),
})
export type TweetView = typeof TweetView.Type

/** One unfurl's state; the atom query's Initial, Success and Failure. */
export const Unfurl = defineTaggedUnion({
	Loading: {},
	Failed: {},
	LoadedLinkPreview: { preview: LinkPreviewData },
	LoadedTweet: { tweet: TweetView },
})
export type Unfurl = typeof Unfurl.Type

export const Unfurls = Schema.Record(Schema.String, Unfurl)
export type Unfurls = typeof Unfurls.Type

export const linkPreviewKey = (url: string) => `preview:${url}`
export const tweetKey = (tweetId: string) => `tweet:${tweetId}`

// TWEET ENRICHMENT (react-tweet's `enrichTweet`, the parts `TweetEmbed` renders)

const Indices = Schema.Tuple([Schema.Number, Schema.Number])

const RawTweet = Schema.Struct({
	id_str: Schema.String,
	text: Schema.String,
	display_text_range: Indices,
	entities: Schema.Struct({
		hashtags: Schema.Array(Schema.Struct({ indices: Indices, text: Schema.String })),
		user_mentions: Schema.Array(Schema.Struct({ indices: Indices, screen_name: Schema.String })),
		urls: Schema.Array(
			Schema.Struct({ indices: Indices, display_url: Schema.String, expanded_url: Schema.String }),
		),
		symbols: Schema.Array(Schema.Struct({ indices: Indices, text: Schema.String })),
		media: Schema.optionalKey(
			Schema.Array(Schema.Struct({ indices: Indices, display_url: Schema.String, expanded_url: Schema.String })),
		),
	}),
	user: Schema.Struct({
		name: Schema.String,
		screen_name: Schema.String,
		profile_image_url_https: Schema.String,
		verified: Schema.optionalKey(Schema.Boolean),
		is_blue_verified: Schema.optionalKey(Schema.Boolean),
	}),
	photos: Schema.optionalKey(
		Schema.Array(Schema.Struct({ url: Schema.String, width: Schema.Number, height: Schema.Number })),
	),
	video: Schema.optionalKey(
		Schema.Struct({ poster: Schema.String, variants: Schema.Array(Schema.Struct({ src: Schema.String })) }),
	),
	favorite_count: Schema.optionalKey(Schema.Number),
	reply_count: Schema.optionalKey(Schema.Number),
	retweet_count: Schema.optionalKey(Schema.Number),
})
type RawTweet = typeof RawTweet.Type

interface Span {
	readonly indices: readonly [number, number]
	readonly type: TweetEntity["type"]
	readonly href: string | null
	/** Replaces the sliced text (`display_url` for urls and media). */
	readonly text: string | null
}

/** `addEntities`: splits the text span that contains each entity around it. */
const addEntities = (result: Span[], entities: ReadonlyArray<Omit<Span, "type"> & { type: Span["type"] }>) => {
	for (const entity of entities) {
		const index = result.findIndex(
			(item) => item.indices[0] <= entity.indices[0] && item.indices[1] >= entity.indices[1],
		)
		if (index === -1) continue
		const item = result[index]!
		const pieces: Span[] = [entity]
		if (item.indices[0] < entity.indices[0])
			pieces.unshift({ indices: [item.indices[0], entity.indices[0]], type: "text", href: null, text: null })
		if (item.indices[1] > entity.indices[1])
			pieces.push({ indices: [entity.indices[1], item.indices[1]], type: "text", href: null, text: null })
		result.splice(index, 1, ...pieces)
	}
}

const getEntities = (tweet: RawTweet): ReadonlyArray<TweetEntity> => {
	const chars = Array.from(tweet.text)
	let rangeEnd = tweet.display_text_range[1]
	const result: Span[] = [{ indices: [tweet.display_text_range[0], rangeEnd], type: "text", href: null, text: null }]
	const { entities } = tweet
	addEntities(
		result,
		entities.hashtags.map((hashtag) => ({
			indices: hashtag.indices,
			type: "hashtag",
			href: `https://x.com/hashtag/${hashtag.text}`,
			text: null,
		})),
	)
	addEntities(
		result,
		entities.user_mentions.map((mention) => ({
			indices: mention.indices,
			type: "mention",
			href: `https://x.com/${mention.screen_name}`,
			text: null,
		})),
	)
	addEntities(
		result,
		entities.urls.map((url) => ({ indices: url.indices, type: "url", href: url.expanded_url, text: url.display_url })),
	)
	addEntities(
		result,
		entities.symbols.map((symbol) => ({
			indices: symbol.indices,
			type: "symbol",
			href: `https://x.com/search?q=%24${symbol.text}`,
			text: null,
		})),
	)
	const media = entities.media ?? []
	addEntities(
		result,
		media.map((item) => ({ indices: item.indices, type: "media", href: item.expanded_url, text: item.display_url })),
	)
	// `fixRange`: media trims the displayed range, and the last span never runs past it.
	const firstMedia = media[0]
	if (firstMedia !== undefined && firstMedia.indices[0] < rangeEnd) rangeEnd = firstMedia.indices[0]
	return result.map((span, index) => {
		const end = index === result.length - 1 && span.indices[1] > rangeEnd ? rangeEnd : span.indices[1]
		return {
			type: span.type,
			text: span.text ?? chars.slice(span.indices[0], end).join(""),
			href: span.href,
		}
	})
}

const toTweetView = (tweet: RawTweet): TweetView => ({
	url: `https://x.com/${tweet.user.screen_name}/status/${tweet.id_str}`,
	text: tweet.text,
	user: {
		name: tweet.user.name,
		screenName: tweet.user.screen_name,
		url: `https://x.com/${tweet.user.screen_name}`,
		avatarUrl: tweet.user.profile_image_url_https,
		isVerified: (tweet.user.verified ?? false) || (tweet.user.is_blue_verified ?? false),
	},
	entities: getEntities(tweet),
	photos: tweet.photos ?? null,
	video: tweet.video ? { poster: tweet.video.poster, src: tweet.video.variants[0]?.src ?? null } : null,
	favoriteCount: tweet.favorite_count ?? null,
	replyCount: tweet.reply_count ?? null,
	retweetCount: tweet.retweet_count ?? null,
})

/** A worker tweet response as `TweetEmbed` renders it, or nothing when it does not decode. */
export const tweetViewOf = (raw: unknown) => Schema.decodeUnknownOption(RawTweet)(raw).pipe(Option.map(toTweetView))

// MESSAGE

export const Message = defineMessageUnion({
	SucceededFetchLinkPreview: { url: Schema.String, preview: LinkPreviewData },
	FailedFetchLinkPreview: { url: Schema.String },
	SucceededFetchTweet: { tweetId: Schema.String, tweet: TweetView },
	FailedFetchTweet: { tweetId: Schema.String },
})
export type Message = typeof Message.Type

/** Folds a fetch result into the unfurl map. */
export const applyMessage = (unfurls: Unfurls, message: Message): Unfurls =>
	Message.match<Unfurls>(message, {
		SucceededFetchLinkPreview: ({ url, preview }) => ({
			...unfurls,
			[linkPreviewKey(url)]: Unfurl.LoadedLinkPreview({ preview }),
		}),
		FailedFetchLinkPreview: ({ url }) => ({ ...unfurls, [linkPreviewKey(url)]: Unfurl.Failed() }),
		SucceededFetchTweet: ({ tweetId, tweet }) => ({ ...unfurls, [tweetKey(tweetId)]: Unfurl.LoadedTweet({ tweet }) }),
		FailedFetchTweet: ({ tweetId }) => ({ ...unfurls, [tweetKey(tweetId)]: Unfurl.Failed() }),
	})

// COMMAND

const getJson = <S extends Schema.Top & { readonly DecodingServices: never }>(path: string, schema: S) =>
	HttpClient.get(`${LINK_PREVIEW_URL}${path}`).pipe(
		Effect.flatMap(HttpClientResponse.filterStatusOk),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
		Effect.provide(FetchHttpClient.layer),
	)

/** `LinkPreviewClient.query("linkPreview", "get", { payload: { url } })`. */
export const FetchLinkPreview = Command.define("FetchLinkPreview", {
	args: { url: Schema.String },
	messages: [Message.SucceededFetchLinkPreview, Message.FailedFetchLinkPreview],
	execute: ({ url }) =>
		getJson(`/link-preview?${new URLSearchParams({ url })}`, LinkPreviewData).pipe(
			Effect.match({
				onSuccess: (preview) => Message.SucceededFetchLinkPreview({ url, preview }),
				onFailure: () => Message.FailedFetchLinkPreview({ url }),
			}),
		),
})

/** `LinkPreviewClient.query("tweet", "get", { payload: { id } })`, enriched like `enrichTweet`. */
export const FetchTweet = Command.define("FetchTweet", {
	args: { tweetId: Schema.String },
	messages: [Message.SucceededFetchTweet, Message.FailedFetchTweet],
	execute: ({ tweetId }) =>
		getJson(`/tweet?${new URLSearchParams({ id: tweetId })}`, RawTweet).pipe(
			Effect.match({
				onSuccess: (tweet) => Message.SucceededFetchTweet({ tweetId, tweet: toTweetView(tweet) }),
				onFailure: () => Message.FailedFetchTweet({ tweetId }),
			}),
		),
})
