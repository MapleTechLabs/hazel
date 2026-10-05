import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ChannelWebhookId } from "@hazel/schema"
import { Schema } from "effect"
import { InternalServerError } from "../errors"
import { MessageEmbed } from "../models/message-embed-schema"
import { RequiredScopes } from "../scopes/required-scopes"

// Incoming webhook payload (Discord-style)
export class IncomingWebhookPayload extends Schema.Class<IncomingWebhookPayload>("IncomingWebhookPayload")({
	content: Schema.optional(Schema.String), // Plain text content
	embeds: Schema.optional(Schema.Array(MessageEmbed)), // Rich embeds
}) {}

// OpenStatus Monitor schema
export const OpenStatusMonitor = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	url: Schema.String,
})
export type OpenStatusMonitor = Schema.Schema.Type<typeof OpenStatusMonitor>

// OpenStatus status type
export const OpenStatusStatus = Schema.Literals(["degraded", "error", "recovered"])
export type OpenStatusStatus = Schema.Schema.Type<typeof OpenStatusStatus>

// OpenStatus webhook payload
export class OpenStatusPayload extends Schema.Class<OpenStatusPayload>("OpenStatusPayload")({
	monitor: OpenStatusMonitor,
	cronTimestamp: Schema.Number,
	status: OpenStatusStatus,
	statusCode: Schema.optional(Schema.Number),
	latency: Schema.optional(Schema.Number),
	errorMessage: Schema.optional(Schema.String),
}) {}

// Railway resource schemas
export const RailwayWorkspace = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
})
export type RailwayWorkspace = Schema.Schema.Type<typeof RailwayWorkspace>

export const RailwayProject = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
})
export type RailwayProject = Schema.Schema.Type<typeof RailwayProject>

export const RailwayEnvironment = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	isEphemeral: Schema.optional(Schema.Boolean),
})
export type RailwayEnvironment = Schema.Schema.Type<typeof RailwayEnvironment>

export const RailwayService = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
})
export type RailwayService = Schema.Schema.Type<typeof RailwayService>

export const RailwayDeployment = Schema.Struct({
	id: Schema.String,
})
export type RailwayDeployment = Schema.Schema.Type<typeof RailwayDeployment>

export const RailwayResource = Schema.Struct({
	workspace: RailwayWorkspace,
	project: RailwayProject,
	environment: Schema.optional(RailwayEnvironment),
	service: Schema.optional(RailwayService),
	deployment: Schema.optional(RailwayDeployment),
})
export type RailwayResource = Schema.Schema.Type<typeof RailwayResource>

export const RailwayDetails = Schema.Struct({
	id: Schema.optional(Schema.String),
	source: Schema.optional(Schema.String),
	status: Schema.optional(Schema.String),
	branch: Schema.optional(Schema.String),
	commitHash: Schema.optional(Schema.String),
	commitAuthor: Schema.optional(Schema.String),
	commitMessage: Schema.optional(Schema.String),
})
export type RailwayDetails = Schema.Schema.Type<typeof RailwayDetails>

// Railway webhook payload
export class RailwayPayload extends Schema.Class<RailwayPayload>("RailwayPayload")({
	type: Schema.String, // e.g., "Deployment.failed", "Alert.triggered"
	details: RailwayDetails,
	resource: RailwayResource,
	severity: Schema.optional(Schema.String), // "WARNING", "ERROR", etc.
	timestamp: Schema.String, // ISO 8601 timestamp
}) {}

// Maple alert webhook schemas (mirror Maple's buildPayload output)
export const MapleEventType = Schema.Literals(["trigger", "resolve", "renotify", "test"])
export type MapleEventType = Schema.Schema.Type<typeof MapleEventType>

export const MapleIncidentStatus = Schema.Literals(["open", "resolved"])
export type MapleIncidentStatus = Schema.Schema.Type<typeof MapleIncidentStatus>

export const MapleSeverity = Schema.Literals(["warning", "critical"])
export type MapleSeverity = Schema.Schema.Type<typeof MapleSeverity>

export const MapleComparator = Schema.Literals(["gt", "gte", "lt", "lte"])
export type MapleComparator = Schema.Schema.Type<typeof MapleComparator>

export const MapleSignalType = Schema.Literals([
	"error_rate",
	"p95_latency",
	"p99_latency",
	"apdex",
	"throughput",
	"metric",
	"query",
])
export type MapleSignalType = Schema.Schema.Type<typeof MapleSignalType>

export const MapleAlertRule = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	signalType: MapleSignalType,
	severity: MapleSeverity,
	groupKey: Schema.NullOr(Schema.String),
	comparator: MapleComparator,
	threshold: Schema.Number,
	windowMinutes: Schema.Number,
})
export type MapleAlertRule = Schema.Schema.Type<typeof MapleAlertRule>

export const MapleObserved = Schema.Struct({
	value: Schema.NullOr(Schema.Number),
	sampleCount: Schema.NullOr(Schema.Number),
})
export type MapleObserved = Schema.Schema.Type<typeof MapleObserved>

export class MaplePayload extends Schema.Class<MaplePayload>("MaplePayload")({
	eventType: MapleEventType,
	incidentId: Schema.NullOr(Schema.String),
	incidentStatus: MapleIncidentStatus,
	dedupeKey: Schema.String,
	rule: MapleAlertRule,
	observed: MapleObserved,
	linkUrl: Schema.String,
	chatUrl: Schema.String,
	sentAt: Schema.String,
}) {}

// Response after successful webhook execution
export class WebhookMessageResponse extends Schema.Class<WebhookMessageResponse>("WebhookMessageResponse")({
	messageId: Schema.String,
	channelId: Schema.String,
}) {}

// Error: Webhook not found
export class WebhookNotFoundError extends Schema.TaggedError<WebhookNotFoundError>()(
	"WebhookNotFoundError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 404 },
) {}

// Error: Webhook is disabled
export class WebhookDisabledError extends Schema.TaggedError<WebhookDisabledError>()(
	"WebhookDisabledError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 403 },
) {}

// Error: Invalid webhook token
export class InvalidWebhookTokenError extends Schema.TaggedError<InvalidWebhookTokenError>()(
	"InvalidWebhookTokenError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 401 },
) {}

// Public endpoint - no auth middleware, uses webhook token in URL
export class IncomingWebhookGroup extends HttpApiGroup.make("incoming-webhooks")
	.add(
		HttpApiEndpoint.post("execute", `/:webhookId/:token`, {
			params: {
				webhookId: ChannelWebhookId,
				token: Schema.String,
			},
			payload: IncomingWebhookPayload,
			success: WebhookMessageResponse,
			error: [
				WebhookNotFoundError,
				WebhookDisabledError,
				InvalidWebhookTokenError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Execute Incoming Webhook",
					description:
						"Post a message to a channel via webhook. Supports plain text content and Discord-style embeds.",
					summary: "Execute webhook to create message",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.add(
		HttpApiEndpoint.post("executeOpenStatus", `/:webhookId/:token/openstatus`, {
			params: {
				webhookId: ChannelWebhookId,
				token: Schema.String,
			},
			payload: OpenStatusPayload,
			success: WebhookMessageResponse,
			error: [
				WebhookNotFoundError,
				WebhookDisabledError,
				InvalidWebhookTokenError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Execute OpenStatus Webhook",
					description:
						"Receive status alerts from OpenStatus and post them as rich embeds to a channel.",
					summary: "Process OpenStatus alert",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.add(
		HttpApiEndpoint.post("executeRailway", `/:webhookId/:token/railway`, {
			params: {
				webhookId: ChannelWebhookId,
				token: Schema.String,
			},
			payload: RailwayPayload,
			success: WebhookMessageResponse,
			error: [
				WebhookNotFoundError,
				WebhookDisabledError,
				InvalidWebhookTokenError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Execute Railway Webhook",
					description:
						"Receive deployment and alert events from Railway and post them as rich embeds to a channel.",
					summary: "Process Railway event",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.add(
		HttpApiEndpoint.post("executeMaple", `/:webhookId/:token/maple`, {
			params: {
				webhookId: ChannelWebhookId,
				token: Schema.String,
			},
			payload: MaplePayload,
			success: WebhookMessageResponse,
			error: [
				WebhookNotFoundError,
				WebhookDisabledError,
				InvalidWebhookTokenError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Execute Maple Webhook",
					description:
						"Receive alert trigger, resolve, renotify, and test events from Maple and post them as rich embeds to a channel.",
					summary: "Process Maple alert",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.prefix("/webhooks/incoming") {}
