import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { InternalServerError, UnauthorizedError } from "../../errors"
import { RateLimitExceededError } from "../../rate-limit-errors"
import { BotNotInstalledError } from "../bot-commands"
import { ChannelNotFoundError } from "./messages"

/**
 * Public API v1 for bots that live outside Hazel (a service holding a bot token): redeeming an
 * install grant (`@hazel/domain/bot-install`), opening a thread on a message, and reading the
 * people in an organization the bot is installed in. Auth: `Authorization: Bearer hzl_bot_…`.
 */

// ============ MODELS ============

export class RedeemBotInstallRequest extends Schema.Class<RedeemBotInstallRequest>("RedeemBotInstallRequest")(
	{
		/** The `code` the consent page added to the redirect URI. */
		code: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
		/** The redirect URI the install was approved for; it must match exactly. */
		redirectUri: Schema.String.check(Schema.isMaxLength(2048)),
	},
) {}

export class BotInstallRedeemedResponse extends Schema.Class<BotInstallRedeemedResponse>(
	"BotInstallRedeemedResponse",
)({
	organizationId: OrganizationId,
	organizationName: Schema.String,
	/** Who approved the install. */
	installedBy: UserId,
}) {}

/** The code is unknown, already redeemed, expired, or was issued to another bot or redirect URI. */
export class BotInstallGrantInvalidError extends Schema.TaggedError<BotInstallGrantInvalidError>()(
	"BotInstallGrantInvalidError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 400 },
) {}

export class ApiV1CreateThreadRequest extends Schema.Class<ApiV1CreateThreadRequest>(
	"ApiV1CreateThreadRequest",
)({
	/** The message the thread hangs off; it must be in the path's channel. */
	messageId: MessageId,
}) {}

export class ThreadResponse extends Schema.Class<ThreadResponse>("ThreadResponse")({
	data: Schema.Struct({
		/** The thread's own channel id: post to it to reply in the thread. */
		id: ChannelId,
		parentChannelId: ChannelId,
		organizationId: OrganizationId,
	}),
}) {}

export class ApiV1UsersQuery extends Schema.Class<ApiV1UsersQuery>("ApiV1UsersQuery")({
	/** Comma-separated user ids, at most 100. */
	ids: Schema.String,
}) {}

export const ApiV1User = Schema.Struct({
	id: UserId,
	displayName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	isBot: Schema.Boolean,
})
export type ApiV1User = typeof ApiV1User.Type

export class ApiV1UsersResponse extends Schema.Class<ApiV1UsersResponse>("ApiV1UsersResponse")({
	/** The ids that are people (or bots) in the organization; unknown ids are left out. */
	data: Schema.Array(ApiV1User),
}) {}

// ============ API GROUP ============

export class BotsApiGroup extends HttpApiGroup.make("api-v1-bots")
	.add(
		HttpApiEndpoint.post("redeemBotInstall", "/bot-installs/token", {
			payload: RedeemBotInstallRequest,
			success: BotInstallRedeemedResponse,
			error: [UnauthorizedError, BotInstallGrantInvalidError, InternalServerError],
		}).annotateMerge(
			OpenApi.annotations({
				title: "Redeem Bot Install",
				description:
					"Exchange the one-time `code` from the bot-install consent page (`/oauth/bot-install`) for the organization the bot was installed in. Single-use, valid for ten minutes, and only for the bot and redirect URI it was issued to.",
				summary: "Redeem bot install",
			}),
		),
	)
	.add(
		HttpApiEndpoint.post("createThread", "/channels/:channelId/threads", {
			params: { channelId: ChannelId },
			payload: ApiV1CreateThreadRequest,
			success: ThreadResponse,
			error: [UnauthorizedError, ChannelNotFoundError, RateLimitExceededError, InternalServerError],
		}).annotateMerge(
			OpenApi.annotations({
				title: "Create Thread",
				description:
					"Open a thread on a message, or answer with the one it already has. A thread is a channel: post to its id to reply in it.",
				summary: "Create thread",
			}),
		),
	)
	.add(
		HttpApiEndpoint.get("listOrganizationUsers", "/organizations/:organizationId/users", {
			params: { organizationId: OrganizationId },
			query: ApiV1UsersQuery,
			success: ApiV1UsersResponse,
			error: [UnauthorizedError, BotNotInstalledError, InternalServerError],
		}).annotateMerge(
			OpenApi.annotations({
				title: "List Organization Users",
				description:
					"Look up people (and bots) in an organization the bot is installed in by id, e.g. the authors of the messages it reads.",
				summary: "List organization users",
			}),
		),
	)
	.prefix("/api/v1") {}
