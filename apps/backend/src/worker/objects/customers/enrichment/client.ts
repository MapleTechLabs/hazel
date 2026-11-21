/**
 * Company lookups against context.dev (https://docs.context.dev) with Hazel's own key
 * (`CONTEXT_DEV_API_KEY`; unset: enrichment is off). One lookup is a Brand retrieve by domain
 * (10 credits; a miss is free) and, when it found a company, a fast Company Search for what Brand
 * lacks (2 credits; empty pages are free), taken only when a result is the same domain.
 *
 * Failures (`EnrichmentLookupError`):
 * - A Brand 400 whose `error_code` says there is no company there (`NO_COMPANY`: no brand, or no
 *   site it can read) is an answer, not a failure: `found: false`. Any other 400 is a failure.
 * - 422 (`FREE_EMAIL_DETECTED`, `DISPOSABLE_EMAIL_DETECTED`, …) → `skipped`: never retried soon;
 *   `COLD_DOMAIN_TIMEOUT_TOO_LOW` → `failed`, retried.
 * - 401/403 → `auth`; 429 → `rate_limited` with the delay; 5xx, timeouts, unreadable bodies → `failed`.
 * A failed search never fails the lookup: Brand's profile stands alone.
 */
import type { CompanyProfile } from "@hazel/domain/customers"
import { Config, Context, Effect, Layer, Option, type Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import type { CustomerProviderError } from "../provider-errors"
import { makeProviderPost } from "../provider-http"
import { isSameCompany, normalizeDomain, toCompanyProfile } from "./map"
import { BrandResponse, CompanySearchResponse, ContextDevErrorBody } from "./wire"

export const CONTEXT_DEV_API_URL = "https://api.context.dev/v1"

/** Brand's answers for a domain with no company to profile (no brand, no site, or a site it cannot read). */
const NO_COMPANY: ReadonlySet<string> = new Set([
	"NOT_FOUND",
	"WEBSITE_NOT_FOUND",
	"WEBSITE_ACCESS_ERROR",
	"WEBSITE_BLOCKED",
])
/** A 422 that a retry with more time fixes, unlike a mail provider's or a disposable address. */
const RETRYABLE_422 = "COLD_DOMAIN_TIMEOUT_TOO_LOW"

/** Nominal credits, for when an answer does not say what it cost. */
const BRAND_CREDITS = 10
const SEARCH_CREDITS = 2
/** context.dev needs ≥ 10 s for a domain it has not seen; Brand's own deadline, under ours. */
const BRAND_TIMEOUT_MS = 30_000
/** A cached Brand profile up to this old will do (context.dev's own default: 3 months). */
const MAX_CACHE_AGE_MS = 90 * 86_400_000
const REQUESTS = { inlineRetries: 1, timeoutMs: 40_000 }

type ContextDevPath = "/brand/retrieve" | "/company/search"

const CONTEXT_DEV = {
	name: "context.dev",
	baseUrl: CONTEXT_DEV_API_URL,
	routeOf: (path: ContextDevPath) => path,
	refusal: ContextDevErrorBody,
	detailOf: ({ error_code: code, message }: typeof ContextDevErrorBody.Type) =>
		[code, message].filter(Boolean).join(": "),
	refusedMessage: (route: string, status: number) => `context.dev refused ${route} (${status})`,
	rateLimitedMessage: "context.dev's rate limit is reached",
	codeOf: (body: typeof ContextDevErrorBody.Type) => body.error_code ?? body.code,
}

export class EnrichmentLookupError extends Schema.TaggedError<
	EnrichmentLookupError,
	{ readonly brand: unique symbol }
>()("EnrichmentLookupError", {
	reason: Schema.Literals(["skipped", "auth", "rate_limited", "failed"]),
	message: Schema.String,
	retryAfterMs: Schema.NullOr(Schema.Finite),
}) {}

export interface CompanyLookup {
	/** Null: context.dev knows no company at this domain. */
	readonly profile: CompanyProfile | null
	readonly creditsUsed: number
}

export interface ContextDevApi {
	/** False without a key: nothing is looked up, and refreshes are refused. */
	readonly enabled: boolean
	/** `fresh`: skip context.dev's cache (a person asked for a refresh). */
	readonly lookup: (
		domain: string,
		options: { readonly fresh: boolean },
	) => Effect.Effect<CompanyLookup, EnrichmentLookupError>
}

const lookupErrorOf = (error: CustomerProviderError): EnrichmentLookupError =>
	new EnrichmentLookupError({
		reason:
			error.code === "auth"
				? "auth"
				: error.code === "rate_limited"
					? "rate_limited"
					: error.httpStatus === 422 && error.providerCode !== RETRYABLE_422
						? "skipped"
						: "failed",
		message: error.message,
		retryAfterMs: error.retryAfterMs,
	})

export const makeContextDev = (
	client: HttpClient.HttpClient,
	apiKey: Option.Option<Redacted.Redacted<string>>,
): ContextDevApi => {
	if (Option.isNone(apiKey)) {
		return {
			enabled: false,
			lookup: () =>
				Effect.fail(
					new EnrichmentLookupError({
						reason: "failed",
						message: "CONTEXT_DEV_API_KEY is not set",
						retryAfterMs: null,
					}),
				),
		}
	}
	const post = makeProviderPost(CONTEXT_DEV, client, apiKey.value, REQUESTS)

	const brand = (domain: string, fresh: boolean) =>
		post(
			"/brand/retrieve",
			{
				type: "by_domain",
				domain,
				// Fresh: context.dev's cache skipped; else as old as the refresh interval.
				maxAgeMs: fresh ? 0 : MAX_CACHE_AGE_MS,
				timeoutOpts: { milliseconds: BRAND_TIMEOUT_MS, behavior: "fail" },
			},
			BrandResponse,
		).pipe(
			Effect.map((response) => ({
				brand: response.brand ?? null,
				credits: response.key_metadata?.credits_consumed ?? BRAND_CREDITS,
			})),
			// No company at this domain: an answer, and free. Any other refusal is a failure.
			Effect.catchIf(
				(error) => error.providerCode !== undefined && NO_COMPANY.has(error.providerCode),
				() => Effect.succeed({ brand: null, credits: 0 }),
			),
		)

	const search = (domain: string, name: string) =>
		post("/company/search", { query: `${name} (${domain})`, mode: "fast" }, CompanySearchResponse).pipe(
			Effect.map((response) => ({
				result: (response.results ?? []).find((result) => isSameCompany(result, domain)) ?? null,
				credits:
					response.key_metadata?.credits_consumed ??
					((response.results ?? []).length > 0 ? SEARCH_CREDITS : 0),
			})),
			// Extra fields only: Brand's profile stands without them.
			Effect.catch((error) =>
				Effect.logWarning("context.dev company search failed", {
					domain,
					code: error.code,
					status: error.httpStatus,
				}).pipe(Effect.as({ result: null, credits: 0 })),
			),
		)

	return {
		enabled: true,
		lookup: Effect.fn("ContextDev.lookup")(function* (
			domain: string,
			options: { readonly fresh: boolean },
		) {
			const normal = normalizeDomain(domain)
			yield* Effect.annotateCurrentSpan({
				"enrichment.domain": normal,
				"enrichment.fresh": options.fresh,
			})
			const found = yield* brand(normal, options.fresh)
			const name = found.brand?.title?.trim() ?? ""
			const extra = name === "" ? { result: null, credits: 0 } : yield* search(normal, name)
			const profile = toCompanyProfile(normal, found.brand, extra.result)
			const creditsUsed = found.credits + extra.credits
			yield* Effect.annotateCurrentSpan({
				"enrichment.found": profile !== null,
				"enrichment.search_matched": extra.result !== null,
				"enrichment.credits": creditsUsed,
			})
			return { profile, creditsUsed }
		}, Effect.mapError(lookupErrorOf)),
	}
}

export class ContextDev extends Context.Service<ContextDev, ContextDevApi>()("@hazel/backend/ContextDev") {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient
			const apiKey = yield* Config.option(Config.Redacted("CONTEXT_DEV_API_KEY"))
			return ContextDev.of(makeContextDev(client, apiKey))
		}),
	).pipe(Layer.provide(FetchHttpClient.layer))
}
