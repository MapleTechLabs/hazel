import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import * as CurrentUser from "../current-user"
import { InternalServerError, UnauthorizedError } from "../errors"
import { OrganizationId } from "@hazel/schema"
import { RequiredScopes } from "../scopes/required-scopes"

// Provider type for bot commands
export const CommandProvider = Schema.Literal("bot")
export type CommandProvider = typeof CommandProvider.Type

// ============ REQUEST SCHEMAS ============

export const CommandArgumentValue = Schema.Struct({
	name: Schema.String,
	value: Schema.String,
})
export type CommandArgumentValue = typeof CommandArgumentValue.Type

// ============ RESPONSE SCHEMAS ============

// Command argument definition
export const CommandArgumentSchema = Schema.Struct({
	name: Schema.String,
	description: Schema.NullishOr(Schema.String),
	required: Schema.Boolean,
	placeholder: Schema.NullishOr(Schema.String),
	type: Schema.Literals(["string", "number", "user", "channel"]),
})
export type CommandArgumentSchema = typeof CommandArgumentSchema.Type

// Bot info for command
export const CommandBotSchema = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	avatarUrl: Schema.NullishOr(Schema.String),
})
export type CommandBotSchema = typeof CommandBotSchema.Type

// Full command definition (bot commands only)
export const IntegrationCommandSchema = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	description: Schema.String,
	provider: CommandProvider,
	arguments: Schema.Array(CommandArgumentSchema),
	usageExample: Schema.NullishOr(Schema.String),
	bot: CommandBotSchema,
})
export type IntegrationCommandSchema = typeof IntegrationCommandSchema.Type

export class AvailableCommandsResponse extends Schema.Class<AvailableCommandsResponse>(
	"AvailableCommandsResponse",
)({
	commands: Schema.Array(IntegrationCommandSchema),
}) {}

// ============ API GROUP ============

export class IntegrationCommandGroup extends HttpApiGroup.make("integration-commands")
	// Get available commands for the current organization
	.add(
		HttpApiEndpoint.get("getAvailableCommands", `/:orgId/commands`, {
			params: { orgId: OrganizationId },
			success: AvailableCommandsResponse,
			error: [UnauthorizedError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Get Available Commands",
					description: "Get all slash commands available from installed bots",
					summary: "List bot commands",
				}),
			)
			.annotate(RequiredScopes, ["bots:read"]),
	)
	.prefix("/integrations")
	.middleware(CurrentUser.Authorization) {}
