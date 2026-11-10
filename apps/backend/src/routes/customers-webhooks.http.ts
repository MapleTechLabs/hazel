/**
 * `POST /webhooks/customers/:provider/:organizationId/:connectionId`: a Customers data source's
 * webhook (`docs/customers/tech-design.md` §5). The org id is in the path, so no directory lookup:
 * the raw body and headers go to the org's `CustomersObject` (`customers.webhook`), whose provider
 * adapter verifies the signature with the connection's secret and parses it; ingest applies it.
 *
 * 400: bad signature or payload (not retried). 404: unknown connection or provider. 500: storage
 * failed (the provider retries; ingest is idempotent).
 */
import { CustomerProvider } from "@hazel/domain/customers"
import { CustomerConnectionId, OrganizationId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
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

export const CustomersWebhookRoutes = HttpRouter.add(
	"POST",
	"/webhooks/customers/*",
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest
		const match = PATH.exec(new URL(request.url, "http://localhost").pathname)
		const params = decodeParams({
			provider: match?.[1],
			organizationId: match?.[2],
			connectionId: match?.[3],
		})
		if (Option.isNone(params)) return HttpServerResponse.text("Not found", { status: 404 })
		if (Number(request.headers["content-length"] ?? 0) > MAX_BODY_BYTES) {
			return HttpServerResponse.text("Payload too large", { status: 413 })
		}
		const body = yield* Effect.option(request.text)
		if (Option.isNone(body)) return HttpServerResponse.text("Unreadable body", { status: 400 })
		const { provider, organizationId, connectionId } = params.value
		yield* Effect.annotateCurrentSpan({
			"customers.provider": provider,
			"organization.id": organizationId,
		})
		const result = yield* callObject(CustomersWebhookCall, customersTarget(organizationId), {
			connectionId,
			provider,
			headers: { ...request.headers },
			body: body.value,
		})
		return HttpServerResponse.jsonUnsafe({ received: true, applied: result.applied })
	}).pipe(
		Effect.catchTags({
			CustomerWebhookFailedError: (error) =>
				Effect.succeed(HttpServerResponse.text(error.message, { status: error.status })),
			ObjectCallError: (error) =>
				Effect.logError("Customers webhook could not reach the object", {
					error: error.message,
				}).pipe(Effect.as(HttpServerResponse.text("Unavailable", { status: 503 }))),
		}),
		Effect.withSpan("CustomersWebhook.receive"),
	),
)
