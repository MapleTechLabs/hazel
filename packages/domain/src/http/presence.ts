import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import { InternalServerError } from "../errors"
import { UserId } from "@hazel/schema"
import { RequiredScopes } from "../scopes/required-scopes"

// Payload for marking user offline
export class MarkOfflinePayload extends Schema.Class<MarkOfflinePayload>("MarkOfflinePayload")({
	userId: UserId,
}) {}

// Response for marking user offline
export class MarkOfflineResponse extends Schema.Class<MarkOfflineResponse>("MarkOfflineResponse")({
	success: Schema.Boolean,
}) {}

export class PresencePublicGroup extends HttpApiGroup.make("presencePublic")
	.add(
		HttpApiEndpoint.post("markOffline", "/offline", {
			payload: MarkOfflinePayload,
			success: MarkOfflineResponse,
			error: InternalServerError,
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Mark User Offline",
					description: "Mark a user as offline when they close their tab (no auth required)",
					summary: "Mark offline",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.prefix("/presence") {}
