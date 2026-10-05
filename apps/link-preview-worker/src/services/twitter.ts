import { FetchHttpClient, HttpClient } from "effect/http"
import { Context, Effect, Layer, Schema } from "effect"

const SYNDICATION_URL = "https://cdn.syndication.twimg.com"
const TWEET_ID_REGEX = /^[0-9]+$/

export class TwitterApiError extends Schema.TaggedError<TwitterApiError>("TwitterApiError")(
	"TwitterApiError",
	{
		message: Schema.String,
		status: Schema.Number,
		data: Schema.optional(Schema.Unknown),
	},
) {}

/**
 * Generate authentication token for Twitter syndication API
 */
function getToken(id: string): string {
	return ((Number(id) / 1e15) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, "")
}

/**
 * Validate tweet ID format
 */
function validateTweetId(id: string): Effect.Effect<string, TwitterApiError> {
	if (id.length > 40 || !TWEET_ID_REGEX.test(id)) {
		return Effect.fail(
			new TwitterApiError({
				message: `Invalid tweet id: ${id}`,
				status: 400,
				data: undefined,
			}),
		)
	}
	return Effect.succeed(id)
}

/**
 * Build Twitter syndication API URL
 */
function buildTweetUrl(id: string): string {
	const url = new URL(`${SYNDICATION_URL}/tweet-result`)

	url.searchParams.set("id", id)
	url.searchParams.set("lang", "en")
	url.searchParams.set(
		"features",
		[
			"tfw_timeline_list:",
			"tfw_follower_count_sunset:true",
			"tfw_tweet_edit_backend:on",
			"tfw_refsrc_session:on",
			"tfw_fosnr_soft_interventions_enabled:on",
			"tfw_show_birdwatch_pivots_enabled:on",
			"tfw_show_business_verified_badge:on",
			"tfw_duplicate_scribes_to_settings:on",
			"tfw_use_profile_image_shape_enabled:on",
			"tfw_show_blue_verified_badge:on",
			"tfw_legacy_timeline_sunset:true",
			"tfw_show_gov_verified_badge:on",
			"tfw_show_business_affiliate_badge:on",
			"tfw_tweet_edit_frontend:on",
		].join(";"),
	)
	url.searchParams.set("token", getToken(id))

	return url.toString()
}

/**
 * Twitter API Service
 * Provides methods to interact with Twitter's syndication API
 */
export class TwitterApi extends Context.Service<TwitterApi>()("TwitterApi", {
	make: Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient

		return {
			/**
			 * Fetch tweet data from Twitter syndication API
			 */
			fetchTweet: (id: string): Effect.Effect<any, TwitterApiError> =>
				Effect.gen(function* () {
					// Validate tweet ID
					yield* validateTweetId(id)

					// Build URL
					const url = buildTweetUrl(id)

					// Make HTTP request with required headers
					const response = yield* httpClient
						.get(url, {
							headers: {
								"User-Agent": "Mozilla/5.0 (compatible; TwitterBot/1.0)",
								Referer: "https://platform.twitter.com/",
							},
						})
						.pipe(
							Effect.mapError(
								(error) =>
									new TwitterApiError({
										message: `Network error: ${String(error)}`,
										status: 0,
										data: undefined,
									}),
							),
						)

					// Parse JSON response
					const data: any = yield* response.json.pipe(Effect.catch(() => Effect.succeed(undefined)))

					// Handle successful response
					if (response.status >= 200 && response.status < 300) {
						// Check for tombstone (deleted tweet)
						if (data?.__typename === "TweetTombstone") {
							return yield* Effect.fail(
								new TwitterApiError({
									message: "Tweet has been deleted",
									status: 404,
									data,
								}),
							)
						}

						// Check for empty response (not found)
						if (data && Object.keys(data).length === 0) {
							return yield* Effect.fail(
								new TwitterApiError({
									message: "Tweet not found",
									status: 404,
									data,
								}),
							)
						}

						// Return tweet data
						return data
					}

					// Handle 404
					if (response.status === 404) {
						return yield* Effect.fail(
							new TwitterApiError({
								message: "Tweet not found",
								status: 404,
								data,
							}),
						)
					}

					// Handle other errors
					const errorMessage =
						data && typeof data.error === "string"
							? data.error
							: `Failed to fetch tweet from "${url}" with status ${response.status}`

					return yield* Effect.fail(
						new TwitterApiError({
							message: errorMessage,
							status: response.status,
							data,
						}),
					)
				}),
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(FetchHttpClient.layer))
}
