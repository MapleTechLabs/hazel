import { HttpClient } from "effect/http"
import { Duration, Effect, Option, Schema, SchemaGetter } from "effect"

export class InvalidAvatarUrlError extends Schema.TaggedError<InvalidAvatarUrlError>()(
	"InvalidAvatarUrlError",
	{
		message: Schema.String,
		url: Schema.String,
	},
) {}

/**
 * Validates that a URL points to an accessible image via HTTP HEAD request.
 */

export const validateImageUrl = Effect.fn("validateImageUrl")(function* (url: string) {
	const httpClient = yield* HttpClient.HttpClient
	const response = yield* httpClient
		.head(url)
		.pipe(Effect.scoped, Effect.timeout(Duration.seconds(5)))
		.pipe(
			Effect.catchTag("TimeoutError", () =>
				Effect.fail(
					new InvalidAvatarUrlError({
						message: "Avatar URL took too long to respond",
						url,
					}),
				),
			),
			Effect.catchTag("HttpClientError", (e) =>
				Effect.fail(
					new InvalidAvatarUrlError({
						message: `Avatar URL request failed: ${e.message}`,
						url,
					}),
				),
			),
		)

	if (response.status >= 400) {
		return yield* Effect.fail(
			new InvalidAvatarUrlError({
				message: `Avatar URL returned ${response.status} error`,
				url,
			}),
		)
	}

	const contentType = Option.fromNullishOr(response.headers["content-type"])
	const isImage = Option.match(contentType, {
		onNone: () => false,
		onSome: (ct: string) => ct.startsWith("image/"),
	})

	if (!isImage) {
		return yield* Effect.fail(
			new InvalidAvatarUrlError({
				message: "Avatar URL must point to an image",
				url,
			}),
		)
	}
})

export const AvatarUrl = Schema.String.check(
	Schema.isPattern(/^https?:\/\/.+/i, {
		message: "Avatar URL must be a valid URL",
	}),
)
	.check(Schema.isMaxLength(2048))
	.pipe(
		Schema.decode({
			decode: SchemaGetter.checkEffect((url: string) =>
				validateImageUrl(url).pipe(
					Effect.map(() => true as const),
					Effect.catch((e: InvalidAvatarUrlError) => Effect.succeed(e.message)),
				),
			),
			encode: SchemaGetter.passthrough(),
		}),
	)
	.annotate({
		description: "A validated URL to an avatar image",
		title: "Avatar URL",
	})

export type AvatarUrl = Schema.Schema.Type<typeof AvatarUrl>
