import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { Effect, Schema } from "effect"
import { CurrentUser } from "../"
import { RequiredScopes } from "../scopes/required-scopes"

// ============ Response Schemas ============

export class KlipyFileVariant extends Schema.Class<KlipyFileVariant>("KlipyFileVariant")({
	url: Schema.String,
	width: Schema.Number,
	height: Schema.Number,
	size: Schema.Number,
}) {}

export class KlipyFileResolution extends Schema.Class<KlipyFileResolution>("KlipyFileResolution")({
	gif: KlipyFileVariant,
	webp: KlipyFileVariant,
	jpg: KlipyFileVariant,
	mp4: KlipyFileVariant,
	webm: KlipyFileVariant,
}) {}

export class KlipyFile extends Schema.Class<KlipyFile>("KlipyFile")({
	hd: KlipyFileResolution,
	md: KlipyFileResolution,
	sm: KlipyFileResolution,
	xs: KlipyFileResolution,
}) {}

export class KlipyGif extends Schema.Class<KlipyGif>("KlipyGif")({
	id: Schema.Number,
	slug: Schema.String,
	title: Schema.String,
	file: KlipyFile,
	type: Schema.String,
	blur_preview: Schema.String,
}) {}

export class KlipySearchResponse extends Schema.Class<KlipySearchResponse>("KlipySearchResponse")({
	data: Schema.Array(KlipyGif),
	current_page: Schema.Number,
	per_page: Schema.Number,
	has_next: Schema.Boolean,
}) {}

export class KlipyCategory extends Schema.Class<KlipyCategory>("KlipyCategory")({
	category: Schema.String,
	query: Schema.String,
	preview_url: Schema.String,
}) {}

export class KlipyCategoriesResponse extends Schema.Class<KlipyCategoriesResponse>("KlipyCategoriesResponse")(
	{
		categories: Schema.Array(KlipyCategory),
	},
) {}

// ============ Error Schemas ============

export class KlipyApiError extends Schema.TaggedError<KlipyApiError>("KlipyApiError")(
	"KlipyApiError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 502 },
) {}

// ============ API Group ============

export class KlipyGroup extends HttpApiGroup.make("klipy")
	.add(
		HttpApiEndpoint.get("trending", "/trending", {
			query: {
				page: Schema.optional(Schema.NumberFromString).pipe(
					Schema.withDecodingDefault(Effect.succeed("1")),
				),
				per_page: Schema.optional(Schema.NumberFromString).pipe(
					Schema.withDecodingDefault(Effect.succeed("25")),
				),
			},
			success: KlipySearchResponse,
			error: KlipyApiError,
		}).annotate(RequiredScopes, ["messages:read"]),
	)
	.add(
		HttpApiEndpoint.get("search", "/search", {
			query: {
				q: Schema.String,
				page: Schema.optional(Schema.NumberFromString).pipe(
					Schema.withDecodingDefault(Effect.succeed("1")),
				),
				per_page: Schema.optional(Schema.NumberFromString).pipe(
					Schema.withDecodingDefault(Effect.succeed("25")),
				),
			},
			success: KlipySearchResponse,
			error: KlipyApiError,
		}).annotate(RequiredScopes, ["messages:read"]),
	)
	.add(
		HttpApiEndpoint.get("categories", "/categories", {
			success: KlipyCategoriesResponse,
			error: KlipyApiError,
		}).annotate(RequiredScopes, ["messages:read"]),
	)
	.prefix("/klipy")
	.middleware(CurrentUser.Authorization) {}
