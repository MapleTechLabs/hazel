/**
 * context.dev's answers, as far as enrichment reads them (https://docs.context.dev): the Brand profile
 * (`POST /v1/brand/retrieve`) and a Company Search result (`POST /v1/company/search`). Lenient on
 * purpose: every field may be missing or null, unknown keys are ignored, and enums are plain strings,
 * so a field context.dev adds or drops never fails a lookup.
 */
import { Schema } from "effect"

const opt = <S extends Schema.Top>(schema: S) => Schema.optionalKey(Schema.NullOr(schema))
const Str = opt(Schema.String)
const Num = opt(Schema.Finite)

export const BrandLogo = Schema.Struct({
	url: Str,
	/** `icon` | `logo`. */
	type: Str,
	/** `light` | `dark` | `has_opaque_background`. */
	mode: Str,
})

export const BrandProfile = Schema.Struct({
	domain: Str,
	title: Str,
	description: Str,
	colors: opt(Schema.Array(Schema.Struct({ hex: Str }))),
	logos: opt(Schema.Array(BrandLogo)),
	socials: opt(Schema.Array(Schema.Struct({ type: Str, url: Str }))),
	address: opt(
		Schema.Struct({
			street: Str,
			city: Str,
			state_province: Str,
			postal_code: Str,
			country: Str,
			country_code: Str,
		}),
	),
	stock: opt(Schema.Struct({ ticker: Str, exchange: Str })),
	/** `range` is `"1 to 10"` … `"10001+"`. */
	employees: opt(Schema.Struct({ range: Str, exact: Num })),
	industries: opt(
		Schema.Struct({ eic: opt(Schema.Array(Schema.Struct({ industry: Str, subindustry: Str }))) }),
	),
	links: opt(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
})
export type BrandProfile = typeof BrandProfile.Type

/** What a call cost, when context.dev says (`X-Credits-Used` is not read: the body carries it too). */
const KeyMetadata = opt(Schema.Struct({ credits_consumed: Num }))

export const BrandResponse = Schema.Struct({
	brand: opt(BrandProfile),
	key_metadata: KeyMetadata,
})
export type BrandResponse = typeof BrandResponse.Type

export const CompanyResult = Schema.Struct({
	name: Str,
	domain: Str,
	description: Str,
	employees: opt(Schema.Struct({ count: Num, min: Num, max: Num })),
	revenue: opt(Schema.Struct({ min_usd: Num, max_usd: Num })),
	funding: opt(
		Schema.Struct({
			stage: Str,
			total_usd: Num,
			rounds: opt(Schema.Array(Schema.Struct({ type: Str, date: Str, amount_usd: Num }))),
		}),
	),
	founded_year: Num,
	organization_type: Str,
	operating_status: Str,
	industries: opt(Schema.Array(Schema.String)),
	headquarters: opt(
		Schema.Struct({
			country_code: Str,
			region: Str,
			city: Str,
			street_address: Str,
			postal_code: Str,
		}),
	),
	socials: opt(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
})
export type CompanyResult = typeof CompanyResult.Type

export const CompanySearchResponse = Schema.Struct({
	results: opt(Schema.Array(CompanyResult)),
	key_metadata: KeyMetadata,
})
export type CompanySearchResponse = typeof CompanySearchResponse.Type

/** context.dev's error body: `{ status: "error", error_code, message }` (seen live; the docs say `code`). */
export const ContextDevErrorBody = Schema.Struct({
	error_code: Schema.optionalKey(Schema.String),
	code: Schema.optionalKey(Schema.String),
	message: Schema.optionalKey(Schema.String),
})
