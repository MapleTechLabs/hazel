import { createHmac, timingSafeEqual } from "node:crypto"
import { verifyWebhook as verifyClerkWebhook } from "@clerk/backend/webhooks"
import { HttpApiBuilder, HttpApiClient } from "effect/http-api"
import { HttpServerRequest } from "effect/http"
import { Cluster, InternalServerError, WorkflowInitializationError } from "@hazel/domain"
import { GitHubWebhookResponse, InvalidGitHubWebhookSignature } from "@hazel/domain/http"
import { Config, Effect, pipe, Redacted } from "effect"
import { HazelApi, InvalidWebhookSignature, WebhookResponse } from "../api"
import { ClerkSync } from "@hazel/backend-core/services"
import { ChannelAccessSyncService } from "../services/channel-access-sync"

export const HttpWebhookLive = HttpApiBuilder.group(HazelApi, "webhooks", (handlers) =>
	handlers
		.handle("clerk", (_args) =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest

				const rawBody = yield* pipe(
					request.text,
					Effect.mapError(
						() =>
							new InvalidWebhookSignature({
								message: "Invalid request body",
							}),
					),
				)

				const signingSecret = yield* Effect.gen(function* () {
					return yield* Config.String("CLERK_WEBHOOK_SECRET")
				}).pipe(
					Effect.catchTag("ConfigError", (err) =>
						Effect.fail(
							new InternalServerError({
								message: "CLERK_WEBHOOK_SECRET not configured",
								detail: String(err),
							}),
						),
					),
				)

				// Reconstruct a WHATWG Request so @clerk/backend's verifyWebhook can read Svix headers.
				const stdRequest = new Request("https://webhooks.local/clerk", {
					method: "POST",
					headers: request.headers as unknown as HeadersInit,
					body: rawBody,
				})

				const event = yield* Effect.tryPromise({
					try: () => verifyClerkWebhook(stdRequest, { signingSecret }),
					catch: (error) =>
						new InvalidWebhookSignature({
							message: `Clerk webhook verification failed: ${error}`,
						}),
				})

				const syncService = yield* ClerkSync
				const channelAccessSync = yield* ChannelAccessSyncService
				const result = yield* syncService.processWebhookEvent(event)

				if (!result.success) {
					yield* Effect.logError("Failed to process Clerk webhook event", {
						type: event.type,
						error: result.error,
					})
				}

				// Re-sync channel access when membership changes come in via webhook (e.g. after
				// a Clerk invitation is accepted). The RPC-backed membership path does this
				// inline; Clerk-originated changes arrive here instead, so we replicate it.
				if (result.success && result.membershipChange) {
					yield* channelAccessSync
						.syncUserInOrganization(
							result.membershipChange.userId,
							result.membershipChange.organizationId,
						)
						.pipe(
							Effect.catch((err) =>
								Effect.logError(
									"Failed to sync channel access after Clerk membership event",
									{
										userId: result.membershipChange!.userId,
										organizationId: result.membershipChange!.organizationId,
										removed: result.membershipRemoved,
										error: String(err),
									},
								),
							),
						)
				}

				return new WebhookResponse({
					success: result.success,
					message: result.success ? "Event processed successfully" : result.error,
				})
			}),
		)
		.handle("github", (_args) =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest

				const eventType = request.headers["x-github-event"] as string | undefined
				const signature = request.headers["x-hub-signature-256"] as string | undefined
				const deliveryId = request.headers["x-github-delivery"] as string | undefined

				if (!eventType || !deliveryId) {
					return yield* Effect.fail(
						new InvalidGitHubWebhookSignature({
							message: "Missing required GitHub webhook headers",
						}),
					)
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

				const webhookSecret = yield* Effect.gen(function* () {
					return yield* Config.Redacted("GITHUB_WEBHOOK_SECRET")
				}).pipe(
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
						return yield* Effect.fail(
							new InvalidGitHubWebhookSignature({
								message: "Missing x-hub-signature-256 header",
							}),
						)
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
						return yield* Effect.fail(
							new InvalidGitHubWebhookSignature({
								message: "Invalid webhook signature",
							}),
						)
					}
				}

				const payload = yield* Effect.try({
					try: () => JSON.parse(rawBody) as Record<string, unknown>,
					catch: (err) =>
						new InternalServerError({
							message: "Invalid GitHub webhook JSON payload",
							detail: String(err),
						}),
				})

				yield* Effect.logInfo("Received GitHub webhook", {
					eventType,
					deliveryId,
					repository: (payload.repository as { full_name?: string } | undefined)?.full_name,
					action: payload.action,
				})

				const clusterUrl = yield* Config.String("CLUSTER_URL")
				const client = yield* HttpApiClient.make(Cluster.WorkflowApi, {
					baseUrl: clusterUrl,
				})

				const wrapWorkflowError = (label: string) => (err: unknown) =>
					Effect.fail(
						new WorkflowInitializationError({
							message: label,
							cause: String(err),
						}),
					)

				if (eventType === "installation") {
					const installation = payload.installation as
						| { id: number; account: { login: string; type: string } }
						| undefined
					const action = payload.action as string | undefined
					const sender = payload.sender as { login: string } | undefined

					if (
						!installation?.id ||
						!installation?.account ||
						!action ||
						!["created", "deleted", "suspend", "unsuspend"].includes(action)
					) {
						yield* Effect.logDebug(
							"Skipping installation webhook - missing fields or unsupported action",
							{
								hasInstallation: !!installation?.id,
								hasAccount: !!installation?.account,
								action,
							},
						)
						return new GitHubWebhookResponse({ processed: false, messagesCreated: 0 })
					}

					yield* client.workflows
						.GitHubInstallationWorkflow({
							payload: {
								deliveryId,
								action: action as "created" | "deleted" | "suspend" | "unsuspend",
								installationId: installation.id,
								accountLogin: installation.account.login,
								accountType: installation.account.type as "User" | "Organization",
								senderLogin: sender?.login ?? "unknown",
							},
						})
						.pipe(
							Effect.tapError((err) =>
								Effect.logError("Failed to execute GitHub installation workflow", {
									deliveryId,
									action,
									installationId: installation.id,
									error: String(err),
								}),
							),
							Effect.catch(wrapWorkflowError("Failed to execute GitHub installation workflow")),
						)

					return new GitHubWebhookResponse({ processed: true, messagesCreated: 0 })
				}

				const repository = payload.repository as { id: number; full_name: string } | undefined
				const installationId = (payload.installation as { id: number } | undefined)?.id

				if (!installationId || !repository?.id || !repository?.full_name) {
					yield* Effect.logDebug("Skipping GitHub webhook - missing required fields", {
						hasInstallation: !!installationId,
						hasRepository: !!repository?.id,
					})
					return new GitHubWebhookResponse({ processed: false, messagesCreated: 0 })
				}

				yield* client.workflows
					.GitHubWebhookWorkflow({
						payload: {
							deliveryId,
							eventType,
							installationId,
							repositoryId: repository.id,
							repositoryFullName: repository.full_name,
							eventPayload: payload,
						},
					})
					.pipe(
						Effect.tapError((err) =>
							Effect.logError("Failed to execute GitHub webhook workflow", {
								deliveryId,
								eventType,
								repository: repository.full_name,
								error: String(err),
							}),
						),
						Effect.catch(wrapWorkflowError("Failed to execute GitHub webhook workflow")),
					)

				return new GitHubWebhookResponse({ processed: true, messagesCreated: 0 })
			}).pipe(
				Effect.catchTag("ConfigError", (err) =>
					Effect.fail(
						new InternalServerError({ message: "Missing configuration", detail: String(err) }),
					),
				),
			),
		),
)
