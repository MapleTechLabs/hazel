/**
 * `POST /webhooks/customers/:provider/:organizationId/:connectionId`: a Customers data source's
 * webhook (`docs/customers/tech-design.md` §5). The org id is in the path; the route checks the org
 * exists (`org_index`) before waking anything, so an arbitrary id creates no object. The raw body
 * (≤ 1 MB, counted while reading) and headers go to the org's `CustomersObject`
 * (`customers.webhook`), whose provider adapter verifies the signature with the connection's
 * secret and parses it; ingest applies it.
 *
 * 400: bad signature or payload, unreadable body. 404: unknown org, connection or provider. 413:
 * body too large. 500: storage failed, 503: directory or object unreachable. Svix-based providers
 * (Clerk, Autumn) retry every non-2xx on their own schedule until they give up; ingest is
 * idempotent, so a retry that does go through is safe.
 */
import { CustomerProvider } from "@hazel/domain/customers"
import { CustomerConnectionId, OrganizationId } from "@hazel/schema"
import { ByteSize, Effect, Option, Schema } from "effect"
import { HttpIncomingMessage, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Directory } from "../services/directory"
import { callObject } from "../worker/objects/calls"
import { CustomersWebhookCall } from "../worker/objects/customers/jobs"
import { customersTarget } from "../worker/objects/kinds"

const PATH = /^\/webhooks\/customers\/([^/]+)\/([^/]+)\/([^/?]+)/

const decodeParams = Schema.decodeUnknownOption(
	Schema.Struct({
		provider: CustomerProvider,
		organizationId: OrganizationId,
		connectionId: CustomerConnectionId,
	}),
)

/** Webhook bodies are small JSON documents; anything larger is refused unread. */
const MAX_BODY_BYTES = 1_000_000

/** The body, read with a hard cap (a lying or missing `content-length` cannot get past it). */
const readBody = (request: HttpServerRequest.HttpServerRequest) =>
	request.text.pipe(
		Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(MAX_BODY_BYTES)),
		Effect.map((text) => ({ _tag: "Read", text }) as const),
		Effect.catchTag("HttpServerError", (error) =>
			Effect.succeed(
				error.reason._tag === "RequestParseError" && error.reason.reason === "BodyTooLarge"
					? ({ _tag: "TooLarge" } as const)
					: ({ _tag: "Unreadable" } as const),
			),
		),
	)

export const handleCustomersWebhook = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	const match = PATH.exec(new URL(request.url, "http://localhost").pathname)
	const params = decodeParams({
		provider: match?.[1],
		organizationId: match?.[2],
		connectionId: match?.[3],
	})
	if (Option.isNone(params)) return HttpServerResponse.text("Not found", { status: 404 })
	const { provider, organizationId, connectionId } = params.value
	yield* Effect.annotateCurrentSpan({
		"customers.provider": provider,
		"organization.id": organizationId,
	})
	const org = yield* (yield* Directory).org(organizationId)
	if (Option.isNone(org) || org.value.deletedAt !== null) {
		return HttpServerResponse.text("Not found", { status: 404 })
	}
	const body = yield* readBody(request)
	if (body._tag === "TooLarge") return HttpServerResponse.text("Payload too large", { status: 413 })
	if (body._tag === "Unreadable") return HttpServerResponse.text("Unreadable body", { status: 400 })
	const result = yield* callObject(CustomersWebhookCall, customersTarget(organizationId), {
		connectionId,
		provider,
		headers: { ...request.headers },
		body: body.text,
	})
	return HttpServerResponse.jsonUnsafe({ received: true, applied: result.applied })
}).pipe(
	Effect.catchTags({
		CustomerWebhookFailedError: (error) =>
			Effect.succeed(HttpServerResponse.text(error.message, { status: error.status })),
		DatabaseError: (error) =>
			Effect.logError("Customers webhook could not check the organization", {
				error: error.message,
			}).pipe(Effect.as(HttpServerResponse.text("Unavailable", { status: 503 }))),
		ObjectCallError: (error) =>
			Effect.logError("Customers webhook could not reach the object", {
				error: error.message,
			}).pipe(Effect.as(HttpServerResponse.text("Unavailable", { status: 503 }))),
	}),
	Effect.withSpan("CustomersWebhook.receive"),
)

export const CustomersWebhookRoutes = HttpRouter.add("POST", "/webhooks/customers/*", handleCustomersWebhook)
