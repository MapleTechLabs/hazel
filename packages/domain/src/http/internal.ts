import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { InvalidBearerTokenError } from "../session-errors"
import { BotId, OrganizationId, UserId } from "@hazel/schema"
import { RequiredScopes } from "../scopes/required-scopes"

// ============================================================================
// Bot Token Validation (for Actor authentication)
// ============================================================================

export class ValidateBotTokenRequest extends Schema.Class<ValidateBotTokenRequest>("ValidateBotTokenRequest")(
	{
		token: Schema.String,
	},
) {}

export class ValidateBotTokenResponse extends Schema.Class<ValidateBotTokenResponse>(
	"ValidateBotTokenResponse",
)({
	userId: UserId,
	botId: BotId,
	organizationId: Schema.NullOr(OrganizationId),
	scopes: Schema.NullOr(Schema.Array(Schema.String)),
}) {}

export class InternalApiGroup extends HttpApiGroup.make("internal")
	.add(
		HttpApiEndpoint.post("validateBotToken", "/actors/validate-bot-token", {
			payload: ValidateBotTokenRequest,
			success: ValidateBotTokenResponse,
			error: [InvalidBearerTokenError, UnauthorizedError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Validate Bot Token",
					description:
						"Validate a bot token and return the bot identity. Used by actors for authentication.",
					summary: "Validate bot token for actors",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.prefix("/internal") {}
