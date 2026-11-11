import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import * as CurrentUser from "../current-user"
import { InternalServerError, UnauthorizedError } from "../errors"
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
			error: [InternalServerError, UnauthorizedError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Mark User Offline",
					description:
						"Mark the signed-in user offline when they close their tab (session cookie or bearer)",
					summary: "Mark offline",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.middleware(CurrentUser.Authorization)
	.prefix("/presence") {}
