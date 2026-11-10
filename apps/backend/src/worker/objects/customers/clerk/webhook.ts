/**
 * One Clerk webhook delivery → `IngestOp`s.
 *
 * Clerk delivers through Svix, so the connection's signing secret verifies `svix-id`,
 * `svix-timestamp` and `svix-signature` over the raw body (`../svix.ts`) before anything is parsed.
 * A bad signature, a replayed delivery or a payload that will not decode is refused, which the
 * route answers 400 and Clerk does not retry; anything else is applied by ingest, which is
 * idempotent, so Clerk's own retries and redeliveries are safe.
 *
 * The events Hazel subscribes to, and what each one writes:
 *
 * | Event | Writes |
 * |---|---|
 * | `organization.created` | account + an `account.created` timeline entry |
 * | `organization.updated` | account (name, logo, seats, slug) |
 * | `organization.deleted` | the ref goes stale; the account is soft-deleted with no live ref left |
 * | `organizationMembership.created` | account + contact (role, `joinedAt`) → `contact.joined` |
 * | `organizationMembership.updated` | contact's role |
 * | `organizationMembership.deleted` | contact removed → `contact.removed` |
 * | `user.created` / `user.updated` | one contact per membership the payload carries |
 * | `user.deleted` | nothing (see below) |
 * | `session.created` | the day's activity (`signedIn`) and the contact's `lastSignInAt` |
 *
 * Two deliberate gaps:
 *
 * - **`user.deleted`** carries only `{ id, deleted }` and the user is already gone, so there is no
 *   way left to learn which accounts they belonged to. Clerk emits
 *   `organizationMembership.deleted` for each of their memberships, and that is what removes the
 *   contacts; the `user.deleted` delivery itself is verified and acknowledged.
 * - **`session.created`** names an organization only once the user has picked one
 *   (`last_active_organization_id`). When it is null Hazel asks Clerk for the user's memberships
 *   (one request) and credits the day to every account they belong to; if that request fails the
 *   delivery still succeeds with no activity rather than being retried forever.
 */
import type { IngestOp } from "@hazel/domain/customers"
import { Clock, Effect, Redacted, Schema } from "effect"
import {
	type CustomerWebhookRejectedError as RejectedError,
	CustomerWebhookRejectedError,
} from "../provider-errors"
import { verifySvix } from "../svix"
import type { ClerkGet } from "./http"
import {
	accountCreatedEvent,
	accountDeletedOp,
	accountOp,
	membershipOps,
	type OnNoMatch,
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

const reject = (message: string) => new CustomerWebhookRejectedError({ message })

const decodeEnvelope = Schema.decodeUnknownEffect(ClerkWebhookEnvelope)

const decodeAs = <A>(schema: Schema.Decoder<A>, data: unknown, type: string) =>
	Schema.decodeUnknownEffect(schema)(data).pipe(
		Effect.mapError(() => reject(`The ${type} payload is not the shape Clerk documents`)),
	)

/** The organizations a user belongs to, for a session that names none. Never fails the delivery. */
const organizationsOfUser = (get: ClerkGet, userId: string) =>
	get(`/users/${userId}/organization_memberships`, [["limit", "100"]], ClerkMembershipsPage).pipe(
		Effect.map((page) =>
			page.data.flatMap((membership) =>
				membership.organization === undefined ? [] : [membership.organization.id],
			),
		),
		Effect.catchTag("CustomerProviderError", (error) =>
			Effect.logWarning("Clerk session could not be attributed to an organization", {
				code: error.code,
				message: error.message,
			}).pipe(Effect.as<ReadonlyArray<string>>([])),
		),
	)

/** A verified delivery's ops. `type` drives everything; unknown types are acknowledged as no-ops. */
export const opsOfEvent = (
	get: ClerkGet,
	envelope: ClerkWebhookEnvelope,
	onNoMatch: OnNoMatch,
): Effect.Effect<ReadonlyArray<IngestOp>, RejectedError> =>
	Effect.gen(function* () {
		const { type, data } = envelope
		const occurredAt = isoOf(envelope.timestamp) ?? new Date(yield* Clock.currentTimeMillis).toISOString()
		switch (type) {
			case "organization.created": {
				const org = yield* decodeAs(ClerkOrganization, data, type)
				return [
					accountOp(org, onNoMatch),
					accountCreatedEvent(org, isoOf(org.created_at) ?? occurredAt),
				]
			}
			case "organization.updated": {
				return [accountOp(yield* decodeAs(ClerkOrganization, data, type), onNoMatch)]
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
					...(type === "organizationMembership.deleted" ? { removed: true } : {}),
				})
			}
			case "user.created":
			case "user.updated": {
				const user = yield* decodeAs(ClerkUser, data, type)
				return (user.organization_memberships ?? []).flatMap((membership) =>
					membershipOps({ membership, user, onNoMatch }),
				)
			}
			case "user.deleted":
				return []
			case "session.created": {
				const session = yield* decodeAs(ClerkSession, data, type)
				const scoped = session.last_active_organization_id
				const organizationIds =
					scoped === null || scoped === undefined
						? yield* organizationsOfUser(get, session.user_id)
						: [scoped]
				return sessionOps(session, organizationIds)
			}
			default:
				return []
		}
	})

/** Verify the delivery, then map it. */
export const receiveWebhook = (input: {
	readonly get: ClerkGet
	readonly headers: Readonly<Record<string, string>>
	readonly body: string
	readonly webhookSecret: Redacted.Redacted<string> | null
	readonly onNoMatch: OnNoMatch
}): Effect.Effect<ReadonlyArray<IngestOp>, RejectedError> =>
	Effect.gen(function* () {
		if (input.webhookSecret === null) {
			return yield* reject("The Clerk connection has no signing secret")
		}
		yield* verifySvix({
			secret: Redacted.value(input.webhookSecret),
			headers: input.headers,
			body: input.body,
			nowMs: yield* Clock.currentTimeMillis,
		}).pipe(Effect.mapError((error) => reject(error.message)))
		const parsed = yield* Effect.try({
			try: () => JSON.parse(input.body) as unknown,
			catch: () => reject("The delivery body is not JSON"),
		})
		const envelope = yield* decodeEnvelope(parsed).pipe(
			Effect.mapError(() => reject("The delivery is not a Clerk webhook envelope")),
		)
		return yield* opsOfEvent(input.get, envelope, input.onNoMatch)
	})
