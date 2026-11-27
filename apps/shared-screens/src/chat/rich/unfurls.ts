// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Link unfurls as queries (today's `web-foldkit/src/chat/unfurl.ts` Commands): one `queryMany` entry
 * per link preview and per tweet, fetched from the install's link-preview worker. A result is the
 * card the row draws; loading and failure are the query's own states.
 */
import { Query } from "@effect/ui"
import type { Content } from "@hazel/ui/vocabulary/index"
import { Content as ContentSchema } from "@hazel/ui/vocabulary/index"
import { Duration, Effect, Layer, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"
import { hostOf, type PreviewRequest } from "./embeds"

/** Why an unfurl has nothing to show: the worker failed or answered nothing usable, or it hung. */
export const UnfurlFailure = Schema.Literals(["Unavailable", "TimedOut"])
export type UnfurlFailure = typeof UnfurlFailure.Type

/** The worker's `LinkPreviewData`; every field is optional. */
export const LinkPreviewData = Schema.Struct({
	url: Schema.optionalKey(Schema.String),
	title: Schema.optionalKey(Schema.String),
	description: Schema.optionalKey(Schema.String),
	image: Schema.optionalKey(Schema.Struct({ url: Schema.optionalKey(Schema.String) })),
})
export type LinkPreviewData = typeof LinkPreviewData.Type

/** The parts of the worker's tweet the card shows. */
export const RawTweet = Schema.Struct({
	text: Schema.String,
	display_text_range: Schema.optionalKey(Schema.Tuple([Schema.Finite, Schema.Finite])),
	user: Schema.Struct({ name: Schema.String, screen_name: Schema.String }),
	photos: Schema.optionalKey(Schema.Array(Schema.Struct({ url: Schema.String }))),
})
export type RawTweet = typeof RawTweet.Type

/** A hung worker must not leave the card loading for the whole visit. */
const UNFURL_TIMEOUT = Duration.seconds(10)

const compact = <A extends object>(value: A): A =>
	// SAFETY: the same object minus keys whose value is undefined, which `A`'s optional keys allow.
	Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as A

/**
 * The worker's JSON, decoded, or why there is none. A fresh fetch client: the app's is the RPC
 * client's, which sends credentials, and the worker answers `Access-Control-Allow-Origin: *`.
 */
const getJson = <S extends Schema.Top & { readonly DecodingServices: never }>(url: string, schema: S) =>
	HttpClient.get(url).pipe(
		Effect.flatMap(HttpClientResponse.filterStatusOk),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
		Effect.provide(Layer.fresh(FetchHttpClient.layer)),
		Effect.timeout(UNFURL_TIMEOUT),
		Effect.mapError((error): UnfurlFailure =>
			error._tag === "TimeoutError" ? "TimedOut" : "Unavailable",
		),
	)

/** A preview as the `embed` card draws it (today's `linkPreviewView`); nothing usable fails. */
export const previewCardOf = (url: string, preview: LinkPreviewData): Option.Option<Content.Embed> => {
	const href = preview.url || url
	if (!preview.title && !preview.description && !preview.image?.url) return Option.none()
	return Option.some(
		compact({
			url: href,
			title: preview.title || hostOf(href),
			description: preview.description || undefined,
			site: hostOf(href),
			image: preview.image?.url || undefined,
		}),
	)
}

/** A tweet as a card: author, text and first photo (today's `tweetView`). */
export const tweetCardOf = (url: string, tweet: RawTweet): Content.Embed => {
	const range = tweet.display_text_range
	const text = range === undefined ? tweet.text : [...tweet.text].slice(range[0], range[1]).join("")
	// HAZEL-GAP(p4-embed-tweet): today's tweet card has the avatar, verified mark, linked entities, photo grid and metrics.
	return compact({
		url,
		title: `${tweet.user.name} @${tweet.user.screen_name}`,
		description: text.trim() || undefined,
		site: "x.com",
		image: tweet.photos?.[0]?.url,
	})
}

/** `LinkPreviewClient.query("linkPreview", "get")`: the card for one link. */
export class GetLinkPreview extends Query.Service<GetLinkPreview>()("hazel/chat/GetLinkPreview", {
	args: { origin: Schema.String, url: Schema.String },
	success: ContentSchema.Embed,
	error: UnfurlFailure,
	staleTime: "1 hour",
}) {
	static readonly layer = this.toLayer(
		Effect.succeed(({ origin, url }) =>
			getJson(`${origin}/link-preview?${new URLSearchParams({ url })}`, LinkPreviewData).pipe(
				Effect.flatMap((preview) =>
					Option.match(previewCardOf(url, preview), {
						onNone: () => Effect.fail<UnfurlFailure>("Unavailable"),
						onSome: Effect.succeed,
					}),
				),
			),
		),
	)
}

/** `LinkPreviewClient.query("tweet", "get")`: the card for one tweet. */
export class GetTweet extends Query.Service<GetTweet>()("hazel/chat/GetTweet", {
	args: { origin: Schema.String, url: Schema.String, tweetId: Schema.String },
	success: ContentSchema.Embed,
	error: UnfurlFailure,
	staleTime: "1 hour",
}) {
	static readonly layer = this.toLayer(
		Effect.succeed(({ origin, url, tweetId }) =>
			getJson(`${origin}/tweet?${new URLSearchParams({ id: tweetId })}`, RawTweet).pipe(
				Effect.map((tweet) => tweetCardOf(url, tweet)),
			),
		),
	)
}

export const unfurlLayer = Layer.mergeAll(GetLinkPreview.layer, GetTweet.layer)

/** The args of every unfurl the rows ask for, deduped and in order. */
export const unfurlArgs = (origin: string, requests: ReadonlyArray<PreviewRequest>) => {
	const links = new Map<string, { origin: string; url: string }>()
	const tweets = new Map<string, { origin: string; url: string; tweetId: string }>()
	for (const request of requests)
		if (request._tag === "Link") links.set(request.url, { origin, url: request.url })
		else tweets.set(request.tweetId, { origin, url: request.url, tweetId: request.tweetId })
	return { links: [...links.values()], tweets: [...tweets.values()] }
}

/** A query's result as far as the card reads it (an `AsyncResult` of a card). */
export type UnfurlResult =
	| { readonly _tag: "Initial"; readonly waiting: boolean }
	| { readonly _tag: "Success"; readonly value: Content.Embed; readonly waiting: boolean }
	| { readonly _tag: "Failure"; readonly waiting: boolean }

/**
 * The card a request shows now: the result's, a loading card while it fetches, the tweet's
 * "not found" when it failed, nothing for a failed link (as today).
 */
export const unfurlCardOf = (
	request: PreviewRequest,
	result: UnfurlResult | undefined,
): Content.Embed | undefined => {
	if (result?._tag === "Success") return result.value
	const site = request._tag === "Tweet" ? "x.com" : hostOf(request.url)
	// HAZEL-GAP(p4-embed-loading): today a loading preview shows "Loading preview…" in muted micro text and a tweet a skeleton; `embed` has no loading state, so the copy is the description.
	if (result === undefined || result._tag === "Initial" || result.waiting)
		return {
			url: request.url,
			title: site,
			description: request._tag === "Tweet" ? "Loading post…" : "Loading preview…",
			site,
		}
	return request._tag === "Tweet" ? { url: request.url, title: "Tweet not found", site } : undefined
}
