/**
 * context.dev answers for tests, shaped like the documented examples (https://docs.context.dev), and
 * a fake context.dev over `HttpClient` that serves them per domain.
 */
import { Effect, Option, Redacted, Schema } from "effect"
import { type HttpBody, HttpClient, HttpClientResponse } from "effect/http"
import { makeContextDev } from "./client"

export const northwindBrand = {
	status: "ok",
	code: 200,
	brand: {
		domain: "northwind.dev",
		title: "Northwind Labs",
		description: "Developer platform for building and running data pipelines on the edge.",
		slogan: "Pipelines at the edge",
		colors: [
			{ hex: "#4F46E5", name: "Indigo" },
			{ hex: "06b6d4", name: "not a hex" },
		],
		logos: [
			{ url: "https://media.context.dev/northwind/logo-dark.svg", type: "logo", mode: "dark" },
			{ url: "https://media.context.dev/northwind/icon.png", type: "icon", mode: "light" },
		],
		socials: [
			{ type: "linkedin", url: "https://www.linkedin.com/company/northwind" },
			{ type: "x", url: "https://x.com/northwind" },
			{ type: "github", url: "javascript:alert(1)" },
		],
		address: {
			street: "Torstraße 140",
			city: "Berlin",
			state_province: "Berlin",
			postal_code: "10119",
			country: "Germany",
			country_code: "de",
		},
		stock: null,
		employees: { range: "201 to 500", exact: 312 },
		industries: { eic: [{ industry: "Technology", subindustry: "Software (B2B)" }] },
		links: {
			careers: "https://northwind.dev/careers",
			pricing: "https://northwind.dev/pricing",
			blog: null,
		},
		primary_language: "en",
	},
	key_metadata: { credits_consumed: 10, credits_remaining: 990 },
}

export const northwindSearch = {
	results: [
		{
			name: "Northwind Traders",
			domain: "northwind-traders.com",
			employees: { count: 40, min: null, max: null },
			revenue: { min_usd: null, max_usd: null },
			funding: { stage: null, total_usd: null, round_count: 0, latest_round: null, rounds: [] },
			founded_year: 1998,
			socials: {},
		},
		{
			name: "Northwind Labs",
			domain: "www.northwind.dev",
			description: "Edge data pipelines.",
			employees: { count: null, min: 201, max: 500 },
			revenue: { min_usd: 20_000_000, max_usd: 50_000_000 },
			funding: {
				stage: "series_b",
				total_usd: 58_000_000,
				round_count: 3,
				latest_round: { type: "series_b", date: "2026-03-10", amount_usd: 40_000_000 },
				rounds: [
					{ type: "series_b", date: "2026-03-10", amount_usd: 40_000_000, phase: "initial" },
					{ type: "series_a", date: "2023-06-01", amount_usd: 14_000_000, phase: "initial" },
					{ type: "seed", date: "2020-02-01", amount_usd: null, phase: null },
				],
			},
			founded_year: 2019,
			organization_type: "privately_held",
			operating_status: "active",
			stock_symbols: [],
			industries: ["Computer Software"],
			headquarters: {
				country_code: "DE",
				region: "Berlin",
				city: "Berlin",
				street_address: null,
				postal_code: null,
			},
			socials: {
				linkedin: "https://www.linkedin.com/company/northwind",
				crunchbase: "https://www.crunchbase.com/organization/northwind",
			},
		},
	],
	key_metadata: { credits_consumed: 2 },
}

export interface FakeContextDevRequest {
	readonly path: string
	readonly body: Record<string, unknown>
	readonly authorization: string
}

export interface FakeContextDevState {
	readonly requests: Array<FakeContextDevRequest>
	/** Domain → the Brand answer: a body (200) or an HTTP status with context.dev's error body. */
	readonly brands: Map<string, unknown>
	/** Domain → the Company Search answer (default: no results). */
	readonly searches: Map<string, unknown>
}

export class FakeStatus {
	constructor(
		readonly status: number,
		readonly code: string,
		readonly headers: Record<string, string> = {},
	) {}
}

const JsonObject = Schema.Record(Schema.String, Schema.Unknown)

const bodyOf = (body: HttpBody.HttpBody): Record<string, unknown> =>
	body._tag === "Uint8Array"
		? Schema.decodeUnknownSync(JsonObject)(JSON.parse(new TextDecoder().decode(body.body)))
		: {}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	})

const answer = (value: unknown) =>
	value instanceof FakeStatus
		? json(value.status, { status: "error", error_code: value.code, message: value.code }, value.headers)
		: value === undefined
			? json(400, {
					status: "error",
					error_code: "WEBSITE_NOT_FOUND",
					message: "Domain branding not present (DNS resolution failed)",
				})
			: json(200, value)

export const makeFakeContextDev = () => {
	const state: FakeContextDevState = { requests: [], brands: new Map(), searches: new Map() }
	const client = HttpClient.make((request, url) =>
		Effect.sync(() => {
			const path = url.pathname.replace(/^\/v1/, "")
			const body = bodyOf(request.body)
			state.requests.push({ path, body, authorization: request.headers["authorization"] ?? "" })
			if (path === "/brand/retrieve")
				return HttpClientResponse.fromWeb(request, answer(state.brands.get(String(body["domain"]))))
			const query = String(body["query"] ?? "")
			const domain = [...state.searches.keys()].find((key) => query.includes(key))
			return HttpClientResponse.fromWeb(
				request,
				answer(domain === undefined ? { results: [] } : state.searches.get(domain)),
			)
		}),
	)
	return {
		state,
		contextDev: makeContextDev(client, Option.some(Redacted.make("cd_test_key"))),
		disabled: makeContextDev(client, Option.none()),
	}
}
