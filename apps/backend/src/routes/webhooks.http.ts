import { createHmac, timingSafeEqual } from "node:crypto"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerRequest } from "effect/http"
import { InternalServerError } from "@hazel/domain"
import {
	GitHubWebhookResponse,
	InvalidGitHubWebhookPayload,
	InvalidGitHubWebhookSignature,
	InvalidSlackWebhookSignature,
	SlackWebhookResponse,
} from "@hazel/domain/http"
import { Slack } from "@hazel/integrations"
import { Cause, Config, Effect, Option, pipe, Redacted, Schema } from "effect"
import { HazelApi } from "../api"
import { dispatchSlackEvent } from "../services/chat-sync/providers/slack/events"
import { Directory } from "../services/directory"
import { relayToInstance } from "../services/oauth-broker/broker"
import { callObject } from "../worker/objects/calls"
import { orgTarget } from "../worker/objects/kinds"
import { GitHubEventCall, GitHubInstallationCall } from "../worker/objects/org/github-webhooks"

/** Installation lifecycle actions the org handles; others are acknowledged and skipped. */
const InstallationAction = Schema.Literals(["created", "deleted", "suspend", "unsuspend"])

const InstallationEvent = Schema.Struct({
	action: InstallationAction,
	installation: Schema.Struct({
		id: Schema.Finite,
		account: Schema.Struct({
			login: Schema.String,
			type: Schema.Literals(["User", "Organization"]),
		}),
	}),
	sender: Schema.optional(Schema.Struct({ login: Schema.String })),
})

/** The fields every repository event the org handles carries. */
const RepositoryEvent = Schema.Struct({
	installation: Schema.Struct({ id: Schema.Finite }),
	repository: Schema.Struct({ id: Schema.Finite, full_name: Schema.String }),
})

const LoggedFields = Schema.Struct({
	action: Schema.optional(Schema.String),
	repository: Schema.optional(Schema.Struct({ full_name: Schema.optional(Schema.String) })),
})

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))
const decodeInstallationAction = Schema.decodeUnknownOption(Schema.Struct({ action: InstallationAction }))
const decodeInstallationEvent = Schema.decodeUnknownEffect(InstallationEvent)
const decodeRepositoryEvent = Schema.decodeUnknownOption(RepositoryEvent)
const decodeLoggedFields = Schema.decodeUnknownOption(LoggedFields)

const skipped = new GitHubWebhookResponse({ processed: false, messagesCreated: 0 })

/**
 * A verified delivery: find the installation's org in the directory (`integration_index`) and
 * hand the event to its `OrgObject` (`worker/objects/org/github-webhooks.ts`).
 */
export const dispatchGitHubEvent = Effect.fn("GitHubWebhook.dispatch")(
	function* (input: {
		readonly eventType: string
		readonly deliveryId: string
		readonly payload: unknown
	}) {
		const { eventType, deliveryId, payload } = input
		const directory = yield* Directory
		const orgOf = (installationId: number) =>
			directory.integration("github", String(installationId)).pipe(
				Effect.tap((row) =>
					Option.isNone(row)
						? Effect.logInfo("GitHub webhook for an unknown installation", {
								deliveryId,
								installationId,
							})
						: Effect.annotateCurrentSpan({ "organization.id": row.value.organizationId }),
				),
			)
		yield* Effect.annotateCurrentSpan({
			"github.event_type": eventType,
			"github.delivery_id": deliveryId,
		})

		if (eventType === "installation") {
			if (Option.isNone(decodeInstallationAction(payload))) {
				yield* Effect.logDebug("Skipping installation webhook - unsupported action", { deliveryId })
				return skipped
			}
			const event = yield* decodeInstallationEvent(payload).pipe(
				Effect.mapError(
					() =>
						new InvalidGitHubWebhookPayload({
							message: "Installation event is missing its installation or account",
						}),
				),
			)
			const org = yield* orgOf(event.installation.id)
			if (Option.isNone(org)) return skipped
			yield* callObject(GitHubInstallationCall, orgTarget(org.value.organizationId), {
				action: event.action,
				installationId: String(event.installation.id),
			})
			return new GitHubWebhookResponse({ processed: true, messagesCreated: 0 })
		}

		const repositoryEvent = decodeRepositoryEvent(payload)
		if (Option.isNone(repositoryEvent)) {
			yield* Effect.logDebug("Skipping GitHub webhook - no installation or repository", {
				deliveryId,
				eventType,
			})
			return skipped
		}
		const { installation, repository } = repositoryEvent.value
		const org = yield* orgOf(installation.id)
		if (Option.isNone(org)) return skipped
		const result = yield* callObject(GitHubEventCall, orgTarget(org.value.organizationId), {
			deliveryId,
			eventType,
			repositoryId: repository.id,
			eventPayload: payload,
		})
		return new GitHubWebhookResponse({ processed: true, messagesCreated: result.messagesCreated })
	},
	Effect.catchTags({
		DatabaseError: (cause) =>
			Effect.fail(InternalServerError.withCause({ message: "Directory lookup failed", cause })),
		ObjectCallError: (cause) =>
			Effect.fail(InternalServerError.withCause({ message: "The organization is unavailable", cause })),
	}),
)

const slackEventFailed = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.catchCause((cause) =>
			Cause.hasInterruptsOnly(cause)
				? Effect.interrupt
				: Effect.logError("Slack event failed", cause).pipe(
						Effect.andThen(
							Effect.fail(new InternalServerError({ message: "Slack event failed" })),
						),
					),
		),
	)

/**
 * A verified Slack delivery's body, applied here: the URL check answered, an event dispatched to
 * chat sync. Also what a delivery relayed by the OAuth broker runs (`routes/oauth-broker.http.ts`).
 */
export const applySlackDelivery = Effect.fn("SlackWebhook.apply")(function* (rawBody: string) {
	const invalid = (message: string) => new InvalidSlackWebhookSignature({ message })
	const body = yield* decodeJson(rawBody).pipe(Effect.mapError(() => invalid("Body is not JSON")))
	const envelope = Slack.decodeSlackEnvelope(body)
	if (Option.isNone(envelope)) return new SlackWebhookResponse({ ok: true })
	switch (envelope.value._tag) {
		case "UrlVerification":
			return new SlackWebhookResponse({ ok: true, challenge: envelope.value.challenge })
		case "Other":
			yield* Effect.logInfo("Slack delivery skipped", { type: envelope.value.type })
			return new SlackWebhookResponse({ ok: true })
		case "EventCallback":
			yield* dispatchSlackEvent(envelope.value).pipe(slackEventFailed)
			return new SlackWebhookResponse({ ok: true })
	}
})

/**
 * Slack's Events API: verify the delivery against `SLACK_SIGNING_SECRET` (on the raw body),
 * answer the URL check, then apply the event (`providers/slack/events.ts`). A failure answers 500,
 * and Slack redelivers the same `event_id`, which chat sync applies once. On Hazel's own install
 * with the OAuth broker on, a workspace brokered to a customer instance has its events relayed
 * there instead (`services/oauth-broker/broker.ts`).
 */
export const handleSlackDelivery = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	const invalid = (message: string) => new InvalidSlackWebhookSignature({ message })
	const rawBody = yield* request.text.pipe(Effect.mapError(() => invalid("Invalid request body")))
	const signingSecret = yield* Config.Redacted("SLACK_SIGNING_SECRET").pipe(
		Effect.tapError(() => Effect.logError("SLACK_SIGNING_SECRET is not configured")),
		Effect.mapError((cause) =>
			InternalServerError.withCause({ message: "Slack events are not configured", cause }),
		),
	)
	const verified = Slack.verifySlackSignature({
		signingSecret: Redacted.value(signingSecret),
		timestamp: request.headers["x-slack-request-timestamp"],
		signature: request.headers["x-slack-signature"],
		rawBody,
		nowSeconds: Math.floor(Date.now() / 1000),
	})
	if (!verified) {
		yield* Effect.logWarning("Invalid Slack request signature")
		return yield* invalid("Invalid request signature")
	}
	const body = yield* decodeJson(rawBody).pipe(Effect.mapError(() => invalid("Body is not JSON")))
	const envelope = Slack.decodeSlackEnvelope(body)
	if (Option.isSome(envelope) && envelope.value._tag === "EventCallback") {
		const relayed = yield* relayToInstance({
			provider: "slack",
			externalId: envelope.value.team_id,
			rawBody,
		}).pipe(
			Effect.catchTag("DatabaseError", (cause) =>
				Effect.fail(InternalServerError.withCause({ message: "Broker route lookup failed", cause })),
			),
		)
		if (Option.isSome(relayed)) {
			if (!relayed.value)
				return yield* new InternalServerError({ message: "Relay to the instance failed" })
			return new SlackWebhookResponse({ ok: true })
		}
	}
	return yield* applySlackDelivery(rawBody)
}).pipe(Effect.withSpan("SlackWebhook.delivery"))

const InstallationRef = Schema.Struct({
	action: Schema.optional(Schema.String),
	installation: Schema.Struct({ id: Schema.Finite }),
})
const decodeInstallationRef = Schema.decodeUnknownOption(InstallationRef)

/**
 * A verified GitHub delivery for an installation brokered to a customer instance, relayed there
 * (`services/oauth-broker/broker.ts`); `none` when the install handles it itself.
 */
const relayGitHubDelivery = Effect.fn("GitHubWebhook.relay")(function* (input: {
	readonly eventType: string
	readonly deliveryId: string
	readonly payload: unknown
	readonly rawBody: string
}) {
	const ref = decodeInstallationRef(input.payload)
	if (Option.isNone(ref)) return Option.none<GitHubWebhookResponse>()
	const installationId = String(ref.value.installation.id)
	const relayed = yield* relayToInstance({
		provider: "github",
		externalId: installationId,
		rawBody: input.rawBody,
		event: input.eventType,
		delivery: input.deliveryId,
	})
	if (Option.isNone(relayed)) return Option.none<GitHubWebhookResponse>()
	if (!relayed.value) return yield* new InternalServerError({ message: "Relay to the instance failed" })
	return Option.some(new GitHubWebhookResponse({ processed: true, messagesCreated: 0 }))
})

export const HttpWebhookLive = HttpApiBuilder.group(HazelApi, "webhooks", (handlers) =>
	handlers
		.handle("slack", () => handleSlackDelivery)
		.handle("github", (_args) =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest

				const eventType = request.headers["x-github-event"]
				const signature = request.headers["x-hub-signature-256"]
				const deliveryId = request.headers["x-github-delivery"]

				if (!eventType || !deliveryId) {
					return yield* new InvalidGitHubWebhookSignature({
						message: "Missing required GitHub webhook headers",
					})
				}

				const rawBody = yield* pipe(
					request.text,
					Effect.mapError(
						() =>
							new InvalidGitHubWebhookSignature({
								message: "Invalid request body",
							}),
					),
				)

				const skipSignatureVerification = yield* Config.Boolean("GITHUB_WEBHOOK_SKIP_SIGNATURE").pipe(
					Config.withDefault(false),
				)

				const webhookSecret = yield* Config.Redacted("GITHUB_WEBHOOK_SECRET").pipe(
					Effect.catchTag("ConfigError", () =>
						skipSignatureVerification
							? Effect.succeed(Redacted.make(""))
							: Effect.fail(
									new InvalidGitHubWebhookSignature({
										message:
											"GITHUB_WEBHOOK_SECRET not configured. Set GITHUB_WEBHOOK_SKIP_SIGNATURE=true to disable in development.",
									}),
								),
					),
				)

				const secretValue = Redacted.value(webhookSecret)
				if (secretValue) {
					if (!signature) {
						yield* Effect.logWarning("Missing GitHub webhook signature header")
						return yield* new InvalidGitHubWebhookSignature({
							message: "Missing x-hub-signature-256 header",
						})
					}

					const bodyHmac = createHmac("sha256", secretValue)
					bodyHmac.update(rawBody)
					const expectedSignature = `sha256=${bodyHmac.digest("hex")}`

					const signatureBuffer = Buffer.from(signature)
					const expectedBuffer = Buffer.from(expectedSignature)

					if (
						signatureBuffer.length !== expectedBuffer.length ||
						!timingSafeEqual(signatureBuffer, expectedBuffer)
					) {
						yield* Effect.logWarning("Invalid GitHub webhook signature", {
							eventType,
							deliveryId,
						})
						return yield* new InvalidGitHubWebhookSignature({
							message: "Invalid webhook signature",
						})
					}
				}

				const payload = yield* decodeJson(rawBody).pipe(
					Effect.mapError(
						() => new InvalidGitHubWebhookPayload({ message: "Webhook body is not valid JSON" }),
					),
				)

				const logged = decodeLoggedFields(payload)
				yield* Effect.logInfo("Received GitHub webhook", {
					eventType,
					deliveryId,
					repository: Option.getOrUndefined(logged)?.repository?.full_name,
					action: Option.getOrUndefined(logged)?.action,
				})

				const relayed = yield* relayGitHubDelivery({ eventType, deliveryId, payload, rawBody }).pipe(
					Effect.catchTag("DatabaseError", (cause) =>
						Effect.fail(
							InternalServerError.withCause({ message: "Broker route lookup failed", cause }),
						),
					),
				)
				if (Option.isSome(relayed)) return relayed.value

				return yield* dispatchGitHubEvent({ eventType, deliveryId, payload })
			}).pipe(
				Effect.catchTag("ConfigError", (cause) =>
					Effect.fail(InternalServerError.withCause({ message: "Missing configuration", cause })),
				),
			),
		),
)
