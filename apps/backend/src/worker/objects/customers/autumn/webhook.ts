/**
 * One Autumn webhook delivery → `IngestOp`s.
 *
 * Autumn delivers through Svix, so the connection's signing secret verifies `svix-id`,
 * `svix-timestamp` and `svix-signature` over the raw body (`../svix.ts`) before anything is parsed.
 * A bad signature, a replayed delivery or a payload that will not decode is refused (the route
 * answers 400). Svix retries any non-2xx on its schedule until it gives up, so only what a retry
 * cannot fix is refused; an event type Hazel does not handle is acknowledged.
 *
 * **A delivery says which customer changed; Hazel reads its current state.** Autumn's payloads
 * carry no plan price, no subscription id for an expired plan and no balance figures, deliveries
 * arrive in any order and are retried for days. So every delivery re-reads its customer the way a
 * pull reads one, and writes that: deliveries applied in any order, or twice, land on the same
 * state, and a webhook writes exactly what a pull would.
 *
 * | Event | Reads | Writes |
 * |---|---|---|
 * | `billing.updated` | `customers.get`, then `plans.list` + `organization` (+ `subscriptions.list` when a plan expired) | the account, its plans and its feature usage |
 * | `balances.limit_reached` | `customers.get` | a `usage.limit_reached` entry and the feature usage |
 * | `balances.usage_alert_triggered` | `customers.get` | a `usage.limit_approaching` entry and the feature usage |
 *
 * **Keeping another organization's — and another environment's — data out.** Autumn stamps a
 * delivery with neither: the envelope is `{ type, data }`. The customer read is what checks it. A
 * secret key opens exactly one organization *and* one environment, so a customer the key cannot see
 * answers a 4xx and is skipped (nothing written, acknowledged), and one it can see carries `env`,
 * which must be the environment the key is for — a sandbox endpoint's signing secret pasted next to
 * a live key writes nothing.
 *
 * Any other failure of the read depends on whether a retry can fix it: a transient one
 * (unreachable, timed out, 429, 5xx) refuses the delivery, nothing written, so Autumn delivers it
 * again later; a permanent one (the key lost its access) is logged and acknowledged, and the next
 * pull reports it on the connection. The reads are never retried in place and give up after 5 s
 * (`WEBHOOK_REQUESTS`): a delivery must answer before Svix times out.
 *
 * Not handled: `billing.auto_topup_succeeded` / `billing.auto_topup_failed` (a prepaid balance
 * recharge, whose invoice is Stripe's to report) and the `vercel.*` marketplace events.
 */
import type { IngestOp, IsoTimestamp } from "@hazel/domain/customers"
import { Clock, Effect, Option, Redacted, Schema } from "effect"
import {
	type CustomerProviderError,
	type CustomerWebhookRejectedError as RejectedError,
	CustomerWebhookRejectedError,
} from "../provider-errors"
import { issueSummary } from "../provider-http"
import { verifySvix } from "../svix"
import { headerOf } from "../webhook-crypto"
import type { AutumnApi } from "./http"
import { customerOps, usageEventOp } from "./map"
import { readCustomer } from "./read"
import {
	AutumnBalanceEvent,
	AutumnBillingUpdated,
	type AutumnEnv,
	AutumnWebhookEnvelope,
	isoOf,
} from "./wire"

export const BILLING_UPDATED = "billing.updated"
export const LIMIT_REACHED = "balances.limit_reached"
export const USAGE_ALERT = "balances.usage_alert_triggered"

/** The event types the webhook endpoint should subscribe to (the UI lists these). */
export const AUTUMN_EVENT_TYPES: ReadonlyArray<string> = [BILLING_UPDATED, LIMIT_REACHED, USAGE_ALERT]

/** Refuse a delivery: logged with the reason (never the payload), answered 400 with `message`. */
const reject = (reason: string, message: string, detail: Record<string, unknown> = {}) =>
	Effect.logWarning("Autumn webhook refused", { reason, ...detail }).pipe(
		Effect.andThen(Effect.annotateCurrentSpan("autumn.webhook.rejected", reason)),
		Effect.andThen(Effect.fail(new CustomerWebhookRejectedError({ message }))),
	)

const decodeEnvelope = Schema.decodeUnknownEffect(Schema.fromJsonString(AutumnWebhookEnvelope))

const decodeAs = <A>(schema: Schema.Decoder<A>, data: unknown, type: string) =>
	Schema.decodeUnknownEffect(schema)(data).pipe(
		Effect.catchTag("SchemaError", (error) =>
			reject("bad_payload", `The ${type} payload is not the shape Autumn documents`, {
				type,
				issues: issueSummary(error),
			}),
		),
	)

/** A read a later attempt can get through: unreachable, timed out, rate limited, or a 5xx. */
export const isTransient = (error: CustomerProviderError): boolean =>
	error.code !== "auth" && error.retryable !== false

/**
 * Verify the delivery, then map it. Core refuses a connection with no signing secret before this.
 * `env` is the environment the connection's key opens (half of `validate`'s `externalAccountId`):
 * the customer read is checked against it.
 */
export const receiveWebhook = Effect.fn("Autumn.receiveWebhook")(function* (input: {
	readonly api: AutumnApi
	readonly headers: Readonly<Record<string, string>>
	readonly body: string
	readonly webhookSecret: Redacted.Redacted<string>
	readonly env: AutumnEnv
	readonly config: Parameters<typeof customerOps>[1]["config"]
}): Effect.fn.Return<ReadonlyArray<IngestOp>, RejectedError> {
	const svixId = headerOf(input.headers, "svix-id")
	if (svixId !== undefined) yield* Effect.annotateCurrentSpan("svix.id", svixId)
	const nowMs = yield* Clock.currentTimeMillis
	yield* verifySvix({
		secret: Redacted.value(input.webhookSecret),
		headers: input.headers,
		body: input.body,
		nowMs,
	}).pipe(Effect.catchTag("SvixVerificationError", (error) => reject(error.reason, error.message)))
	const envelope = yield* decodeEnvelope(input.body).pipe(
		Effect.catchTag("SchemaError", (error) =>
			reject("bad_envelope", "The delivery is not an Autumn webhook envelope", {
				issues: issueSummary(error),
			}),
		),
	)
	yield* Effect.annotateCurrentSpan("autumn.webhook.type", envelope.type)
	if (!AUTUMN_EVENT_TYPES.includes(envelope.type)) return []
	// Taken before the reads: the time the ops are observed at.
	const at = new Date(nowMs)
	const observedAt: IsoTimestamp = at.toISOString()
	const occurredAt = isoOf(envelope.occurred_at) ?? observedAt
	// Svix guarantees a message id; without one (a hand-made delivery) the body's own id, else the time.
	const deliveryId = envelope.id ?? svixId ?? observedAt

	const ops =
		envelope.type === BILLING_UPDATED
			? yield* billingUpdatedOps(input, envelope.data, { at, observedAt })
			: yield* balanceEventOps(input, envelope, { at, observedAt, occurredAt, deliveryId })
	yield* Effect.annotateCurrentSpan("autumn.webhook.ops", ops.length)
	return ops
})

type Input = Parameters<typeof receiveWebhook>[0]

interface Timing {
	readonly at: Date
	readonly observedAt: IsoTimestamp
}

/**
 * The customer's state as a delivery writes it; `None` when Autumn does not know the customer under
 * this key (another organization's, or deleted since). A read that fails classifies the delivery.
 */
const stateOf = (input: Input, customerId: string, timing: Timing, expired: boolean) =>
	readCustomer({
		api: input.api,
		customerId,
		env: input.env,
		config: input.config,
		at: timing.at,
		observedAt: timing.observedAt,
		withExpired: expired,
	})

/** Either the read's ops, or the right answer for a read that failed. */
const applied = (
	type: string,
	read: Effect.Effect<ReadonlyArray<IngestOp>, CustomerProviderError | RejectedError>,
) =>
	read.pipe(
		Effect.catchTag("CustomerProviderError", (error) =>
			isTransient(error)
				? reject(
						"autumn_unavailable",
						"Autumn could not be read for the customer's current state; retry later",
						{ type, code: error.code, status: error.httpStatus },
					)
				: Effect.logWarning("Autumn delivery acknowledged unread", {
						type,
						code: error.code,
						message: error.message,
					}).pipe(Effect.as<ReadonlyArray<IngestOp>>([])),
		),
	)

const billingUpdatedOps = Effect.fnUntraced(function* (input: Input, data: unknown, timing: Timing) {
	const payload = yield* decodeAs(AutumnBillingUpdated, data, BILLING_UPDATED)
	// An entity's plans are a sub-customer's, not the account's.
	if (payload.entity_id != null && payload.entity_id !== "") return []
	// Only `subscriptions.list` names an expired plan's subscription, so read it when one ended.
	const expired = payload.plan_changes.some((change) => change.action === "expired")
	yield* Effect.annotateCurrentSpan({
		"autumn.customer_changes": payload.plan_changes.length,
		"autumn.read_expired": expired,
	})
	return yield* applied(
		BILLING_UPDATED,
		stateOf(input, payload.customer_id, timing, expired).pipe(
			Effect.map((state) => (Option.isNone(state) ? [] : state.value.ops)),
		),
	)
})

const balanceEventOps = Effect.fnUntraced(function* (
	input: Input,
	envelope: AutumnWebhookEnvelope,
	timing: Timing & { readonly occurredAt: IsoTimestamp; readonly deliveryId: string },
) {
	const payload = yield* decodeAs(AutumnBalanceEvent, envelope.data, envelope.type)
	const kind = envelope.type === LIMIT_REACHED ? "limit_reached" : "usage_alert"
	return yield* applied(
		envelope.type,
		stateOf(input, payload.customer_id, timing, false).pipe(
			Effect.map((state): ReadonlyArray<IngestOp> => {
				if (Option.isNone(state)) return []
				const event = usageEventOp(payload, {
					kind,
					deliveryId: timing.deliveryId,
					occurredAt: timing.occurredAt,
					names: state.value.names,
				})
				// The account and its fresh balances first: the entry names the account they create.
				return event === null ? state.value.ops : [...state.value.ops, event]
			}),
		),
	)
})
