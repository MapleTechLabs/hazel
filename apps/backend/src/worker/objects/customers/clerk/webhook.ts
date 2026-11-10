/**
 * One Clerk webhook delivery → `IngestOp`s.
 *
 * Clerk delivers through Svix, so the connection's signing secret verifies `svix-id`,
 * `svix-timestamp` and `svix-signature` over the raw body (`../svix.ts`) before anything is parsed.
 * A bad signature, a replayed delivery, a payload that will not decode, or an event from another
 * Clerk instance than the one the secret key opens is refused (the route answers 400). Svix retries
 * any non-2xx on its schedule until it gives up, so only what a retry cannot fix is refused; an
 * event type Hazel does not handle is acknowledged. Everything else is applied by ingest, which is
 * idempotent, so Clerk's retries and redeliveries are safe; account and contact ops carry
 * `observedAt`, so a late retry cannot revive a record deleted since.
 *
 * The events Hazel subscribes to, and what each one writes:
 *
 * | Event | Writes |
 * |---|---|
 * | `organization.created` | account + an `account.created` timeline entry |
 * | `organization.updated` | account (name, logo, seats, slug) |
 * | `organization.deleted` | the ref goes stale; the account is soft-deleted with no live ref left |
 * | `organizationMembership.created` | account + contact (role, `joinedAt`) → `contact.joined` |
 * | `organizationMembership.updated` | account + contact's role |
 * | `organizationMembership.deleted` | contact removed → `contact.removed` (never the account) |
 * | `user.created` / `user.updated` | one contact per membership Clerk lists for the user |
 * | `user.deleted` | nothing (see below) |
 * | `session.created` | the contact (`lastSignInAt`) and the day's activity (`signedIn`) |
 *
 * `user.*` and `session.*` payloads carry no memberships, so both ask Clerk for the user's
 * (`GET /users/{id}/organization_memberships`, one request). If that request fails the delivery is
 * still acknowledged with what is known (a session's own organization's sign-in day) and the next
 * sweep fills the rest, rather than Svix retrying it for days.
 *
 * **`user.deleted`** carries only `{ id, deleted }` and the user is already gone, so there is no way
 * left to learn which accounts they belonged to. Clerk emits `organizationMembership.deleted` for
 * each of their memberships, and that is what removes the contacts.
 */
import type { IngestOp, IsoTimestamp } from "@hazel/domain/customers"
import { Clock, Effect, Option, Redacted, Schema } from "effect"
import {
	type CustomerWebhookRejectedError as RejectedError,
	CustomerWebhookRejectedError,
} from "../provider-errors"
import { headerOf, verifySvix } from "../svix"
import { dayOf } from "../time"
import { type ClerkGet, issueSummary } from "./http"
import {
	accountCreatedEvent,
	accountDeletedOp,
	accountOp,
	membershipOps,
	type OnNoMatch,
	sessionActivityOp,
	sessionOps,
} from "./map"
import {
	ClerkDeletedObject,
	ClerkMembership,
	ClerkMembershipsPage,
	ClerkOrganization,
	ClerkSession,
	ClerkUser,
	ClerkWebhookEnvelope,
	isoOf,
} from "./wire"

/** Refuse a delivery: logged with the reason (never the payload), answered 400 with `message`. */
const reject = (reason: string, message: string, detail: Record<string, unknown> = {}) =>
	Effect.logWarning("Clerk webhook refused", { reason, ...detail }).pipe(
		Effect.andThen(Effect.annotateCurrentSpan("clerk.webhook.rejected", reason)),
		Effect.andThen(Effect.fail(new CustomerWebhookRejectedError({ message }))),
	)

const decodeEnvelope = Schema.decodeUnknownEffect(Schema.fromJsonString(ClerkWebhookEnvelope))

const decodeAs = <A>(schema: Schema.Decoder<A>, data: unknown, type: string) =>
	Schema.decodeUnknownEffect(schema)(data).pipe(
		Effect.catchTag("SchemaError", (error) =>
			reject("bad_payload", `The ${type} payload is not the shape Clerk documents`, {
				type,
				issues: issueSummary(error),
			}),
		),
	)

/** The user's memberships Clerk lists; `None` when Clerk could not be asked. Never fails the delivery. */
const membershipsOfUser = (get: ClerkGet, userId: string) =>
	get(`/users/${userId}/organization_memberships`, [["limit", "100"]], ClerkMembershipsPage).pipe(
		Effect.map((page) => Option.some(page.data)),
		Effect.catchTag("CustomerProviderError", (error) =>
			Effect.logWarning("Clerk user's memberships could not be listed", {
				code: error.code,
				message: error.message,
			}).pipe(Effect.as(Option.none<ReadonlyArray<ClerkMembership>>())),
		),
	)

/** A verified delivery's ops. `type` drives everything; unknown types are acknowledged as no-ops. */
export const opsOfEvent = Effect.fn("Clerk.opsOfEvent")(function* (
	get: ClerkGet,
	envelope: ClerkWebhookEnvelope,
	onNoMatch: OnNoMatch,
): Effect.fn.Return<ReadonlyArray<IngestOp>, RejectedError> {
	const { type, data } = envelope
	const eventAt = isoOf(envelope.timestamp)
	/** The record's own `updated_at`, else the event's time. */
	const observed = (updatedAt: number | null | undefined): IsoTimestamp | undefined =>
		isoOf(updatedAt) ?? eventAt ?? undefined
	switch (type) {
		case "organization.created": {
			const org = yield* decodeAs(ClerkOrganization, data, type)
			const occurredAt =
				isoOf(org.created_at) ?? eventAt ?? new Date(yield* Clock.currentTimeMillis).toISOString()
			return [accountOp(org, onNoMatch, observed(org.updated_at)), accountCreatedEvent(org, occurredAt)]
		}
		case "organization.updated": {
			const org = yield* decodeAs(ClerkOrganization, data, type)
			return [accountOp(org, onNoMatch, observed(org.updated_at))]
		}
		case "organization.deleted": {
			const deleted = yield* decodeAs(ClerkDeletedObject, data, type)
			return deleted.id === undefined ? [] : [accountDeletedOp(deleted.id)]
		}
		case "organizationMembership.created":
		case "organizationMembership.updated":
		case "organizationMembership.deleted": {
			const membership = yield* decodeAs(ClerkMembership, data, type)
			return membershipOps({
				membership,
				onNoMatch,
				// A removal writes the contact only, never the (possibly deleted) organization.
				removed: type === "organizationMembership.deleted",
				observedAt: observed(membership.updated_at),
			})
		}
		case "user.created":
		case "user.updated": {
			const user = yield* decodeAs(ClerkUser, data, type)
			const memberships = yield* membershipsOfUser(get, user.id)
			return Option.getOrElse(memberships, () => []).flatMap((membership) =>
				membershipOps({
					membership,
					user,
					onNoMatch,
					// The membership's organization is not the event's subject: its own events write it.
					withAccount: false,
					observedAt: observed(user.updated_at),
				}),
			)
		}
		case "user.deleted":
			return []
		case "session.created": {
			const session = yield* decodeAs(ClerkSession, data, type)
			const scoped = session.last_active_organization_id ?? null
			const memberships = yield* membershipsOfUser(get, session.user_id)
			if (Option.isSome(memberships)) {
				const credited =
					scoped === null
						? memberships.value
						: memberships.value.filter((membership) => membership.organization?.id === scoped)
				return sessionOps(session, credited, observed(session.created_at))
			}
			// Clerk could not be asked: the session's own organization still gets its sign-in day.
			const at = isoOf(session.created_at) ?? isoOf(session.last_active_at)
			return scoped === null || at === null
				? []
				: [sessionActivityOp(session.user_id, scoped, dayOf(new Date(at)))]
		}
		default:
			return []
	}
})

/**
 * Verify the delivery, then map it. Core refuses a connection with no signing secret before this.
 * `instanceId` is the Clerk instance the connection's secret key opens (null when Clerk did not
 * say): an event from any other instance is refused, so a development instance's webhook cannot
 * write into a production connection, nor make Hazel fetch its users with the production key.
 */
export const receiveWebhook = Effect.fn("Clerk.receiveWebhook")(function* (input: {
	readonly get: ClerkGet
	readonly headers: Readonly<Record<string, string>>
	readonly body: string
	readonly webhookSecret: Redacted.Redacted<string>
	readonly instanceId: string | null
	readonly onNoMatch: OnNoMatch
}): Effect.fn.Return<ReadonlyArray<IngestOp>, RejectedError> {
	const svixId = headerOf(input.headers, "svix-id")
	if (svixId !== undefined) yield* Effect.annotateCurrentSpan("svix.id", svixId)
	yield* verifySvix({
		secret: Redacted.value(input.webhookSecret),
		headers: input.headers,
		body: input.body,
		nowMs: yield* Clock.currentTimeMillis,
	}).pipe(Effect.catchTag("SvixVerificationError", (error) => reject(error.reason, error.message)))
	const envelope = yield* decodeEnvelope(input.body).pipe(
		Effect.catchTag("SchemaError", (error) =>
			reject("bad_envelope", "The delivery is not a Clerk webhook envelope", {
				issues: issueSummary(error),
			}),
		),
	)
	yield* Effect.annotateCurrentSpan("clerk.webhook.type", envelope.type)
	const instance = envelope.instance_id ?? null
	if (input.instanceId !== null && instance !== null && instance !== input.instanceId) {
		return yield* reject(
			"instance_mismatch",
			"The event comes from another Clerk instance than the connection's secret key opens",
			{ type: envelope.type, instanceId: instance, expected: input.instanceId },
		)
	}
	return yield* opsOfEvent(input.get, envelope, input.onNoMatch)
})
