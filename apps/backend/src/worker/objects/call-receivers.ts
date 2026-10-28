/**
 * The object side of `./calls.ts`: each kind's receivers, and `ObjectCalls`, which runs one call
 * over the services captured when the object's handlers were built (its `Database`, the app
 * services). The runtime provides `CurrentObject` and flushes after it.
 */
import type { MessageRepo, IntegrationConnectionRepo } from "@hazel/backend-core"
import type { Database } from "@hazel/db"
import type { GitHub } from "@hazel/integrations"
import { Cause, Context, Effect, Exit, Layer, Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import type { CurrentObject } from "../../lib/current-object"
import type { ChannelAccessSyncService } from "../../services/channel-access-sync"
import type { ChannelViewers } from "../../services/channel-viewers"
import type { ChatSyncAttributionReconciler } from "../../services/chat-sync/chat-sync-attribution-reconciler"
import type { Directory } from "../../services/directory"
import type { IntegrationTokenService } from "../../services/integration-token-service"
import type { IntegrationBotService } from "../../services/integrations/integration-bot-service"
import type { WebhookBotService } from "../../services/webhook-bot-service"
import { type AnyObjectCall, type CallRequest, type CallResponse, exitCodec, payloadCodec } from "./calls"
import { listMessages, ListMessagesCall } from "./channel/api-messages"
import { finalizeNothing, finalizeOrgImport, ImportCalls, importRows } from "./import"
import type { ObjectKind } from "./kinds"
import {
	isOrgAdmin,
	IsOrgAdminCall,
	listChannels,
	ListChannelsCall,
	organizationProfile,
	OrganizationProfileCall,
} from "./org/api-v1"
import {
	githubEvent,
	GitHubEventCall,
	githubInstallation,
	GitHubInstallationCall,
} from "./org/github-webhooks"
import { executeWebhook, ExecuteWebhookCall } from "./org/incoming-webhooks"
import {
	activeIntegrations,
	ActiveIntegrationsCall,
	connectIntegration,
	ConnectIntegrationCall,
	disconnectIntegration,
	DisconnectIntegrationCall,
	integrationAccessToken,
	IntegrationAccessTokenCall,
	integrationConnection,
	IntegrationConnectionCall,
} from "./org/integrations"
import type { ObjectStubs } from "./protocol"

/** What a receiver may use: the object's storage and platform, and the app services. */
export type CallServices =
	| Database.Database
	| SqlClient
	| ObjectStubs
	| Directory
	| MessageRepo
	| IntegrationConnectionRepo
	| ChannelViewers
	| IntegrationTokenService
	| IntegrationBotService
	| WebhookBotService
	| ChatSyncAttributionReconciler
	| ChannelAccessSyncService
	| GitHub.GitHubAppJWTService

interface Receiver {
	readonly call: AnyObjectCall
	readonly receive: (payload: any) => Effect.Effect<unknown, unknown, CallServices | CurrentObject>
}

const receiver = <C extends AnyObjectCall>(
	call: C,
	receive: (
		payload: C["payload"]["Type"],
	) => Effect.Effect<C["success"]["Type"], C["error"]["Type"], CallServices | CurrentObject>,
): Receiver => ({ call, receive })

const byName = (receivers: ReadonlyArray<Receiver>) =>
	new Map(receivers.map((entry) => [entry.call.name, entry]))

export const callReceivers: Record<ObjectKind, ReadonlyMap<string, Receiver>> = {
	org: byName([
		receiver(ExecuteWebhookCall, executeWebhook),
		receiver(IntegrationConnectionCall, integrationConnection),
		receiver(IntegrationAccessTokenCall, integrationAccessToken),
		receiver(ActiveIntegrationsCall, () => activeIntegrations()),
		receiver(ConnectIntegrationCall, connectIntegration),
		receiver(DisconnectIntegrationCall, disconnectIntegration),
		receiver(GitHubEventCall, githubEvent),
		receiver(GitHubInstallationCall, githubInstallation),
		receiver(OrganizationProfileCall, () => organizationProfile()),
		receiver(ListChannelsCall, listChannels),
		receiver(IsOrgAdminCall, isOrgAdmin),
		receiver(ImportCalls.org.rows, importRows("org")),
		receiver(ImportCalls.org.finalize, finalizeOrgImport),
	]),
	channel: byName([
		receiver(ListMessagesCall, listMessages),
		receiver(ImportCalls.channel.rows, importRows("channel")),
		receiver(ImportCalls.channel.finalize, finalizeNothing),
	]),
	user: byName([
		receiver(ImportCalls.user.rows, importRows("user")),
		receiver(ImportCalls.user.finalize, finalizeNothing),
	]),
}

export interface ObjectCallsShape {
	/** Run one call; never fails, the outcome is the encoded exit. Needs `CurrentObject`. */
	readonly run: (
		kind: ObjectKind,
		request: CallRequest,
	) => Effect.Effect<CallResponse, never, CurrentObject>
}

export class ObjectCalls extends Context.Service<ObjectCalls, ObjectCallsShape>()(
	"@hazel/backend/ObjectCalls",
) {
	static readonly layer: Layer.Layer<ObjectCalls, never, CallServices> = Layer.effect(
		this,
		Effect.gen(function* () {
			const context = yield* Effect.context<CallServices>()
			const encode = (call: AnyObjectCall, exit: Exit.Exit<unknown, unknown>) =>
				Schema.encodeEffect(exitCodec(call))(exit).pipe(
					// An error outside the call's schema (a receiver bug) crosses as a defect.
					Effect.catchTag("SchemaError", (error) =>
						Schema.encodeEffect(exitCodec(call))(
							Exit.die(
								`${call.name} failed with a value its error schema rejects: ${error.message}`,
							),
						),
					),
					Effect.orDie,
				)
			const run = (kind: ObjectKind, request: CallRequest) =>
				Effect.gen(function* () {
					const entry = callReceivers[kind].get(request.name)
					if (entry === undefined) {
						const unknown = {
							name: request.name,
							success: Schema.Never,
							error: Schema.Never,
						} as never
						return {
							exit: yield* encode(
								unknown,
								Exit.die(`${kind} objects do not answer ${request.name}`),
							),
						}
					}
					const payload = yield* Schema.decodeUnknownEffect(payloadCodec(entry.call))(
						request.payload,
					).pipe(Effect.exit)
					const exit = Exit.isFailure(payload)
						? Exit.die(`Undecodable ${request.name} payload`)
						: yield* entry.receive(payload.value).pipe(
								Effect.provideContext(context),
								Effect.exit,
								Effect.tap((result) =>
									Exit.isFailure(result) && Cause.hasDies(result.cause)
										? Effect.logError("Object call died", {
												call: request.name,
												cause: result.cause,
											})
										: Effect.void,
								),
							)
					return { exit: yield* encode(entry.call, exit) }
				}).pipe(
					Effect.withSpan("ObjectCall.receive", {
						kind: "server",
						attributes: { "call.name": request.name, "object.kind": kind },
					}),
				)
			return { run }
		}),
	)
}
