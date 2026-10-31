import { installRedirectUrl } from "@hazel/domain/bot-install"
import { BotId, OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { load } from "foldkit/navigation"
import { catchCommon } from "../../data/actions"
import { signInHref } from "../../route"
import { HazelRpc } from "../../rpc"
import { Message } from "./message"

export const FetchInstallRequest = Command.define("FetchInstallRequest", {
	args: { botId: BotId, redirectUri: Schema.String },
	messages: [Message.SucceededFetchRequest, Message.FoundInvalidRequest, Message.FailedFetchRequest],
	execute: ({ botId, redirectUri }) =>
		HazelRpc.use((client) => client("bot.getInstallRequest", { botId, redirectUri })).pipe(
			Effect.map((bot) =>
				Message.SucceededFetchRequest({
					bot: {
						id: bot.id,
						name: bot.name,
						description: bot.description,
						avatarUrl: bot.avatarUrl,
						creatorName: bot.creatorName,
					},
				}),
			),
			Effect.catchTags({
				BotNotFoundError: () => Effect.succeed(Message.FoundInvalidRequest()),
				BotInstallRedirectMismatchError: () => Effect.succeed(Message.FoundInvalidRequest()),
			}),
			catchCommon((reason) => Message.FailedFetchRequest({ reason })),
		),
})

/** Install, then hand the grant to the bot's redirect URI. */
export const ApproveInstall = Command.define("ApproveInstall", {
	args: { botId: BotId, organizationId: OrganizationId, redirectUri: Schema.String, state: Schema.String },
	messages: [Message.LeftPage, Message.FailedApprove],
	execute: ({ botId, organizationId, redirectUri, state }) =>
		HazelRpc.use((client) => client("bot.authorizeInstall", { botId, organizationId, redirectUri })).pipe(
			Effect.flatMap(({ code }) => load(installRedirectUrl(redirectUri, { code, state }))),
			Effect.as(Message.LeftPage()),
			Effect.catchTags({
				UnauthorizedError: () => Effect.succeed(Message.FailedApprove({ reason: "NotAdmin" })),
				BotNotFoundError: () => Effect.succeed(Message.FailedApprove({ reason: "Invalid" })),
				BotInstallRedirectMismatchError: () =>
					Effect.succeed(Message.FailedApprove({ reason: "Invalid" })),
				ActiveOrganizationRequiredError: () =>
					Effect.succeed(Message.FailedApprove({ reason: "Invalid" })),
			}),
			catchCommon((reason) => Message.FailedApprove({ reason })),
		),
})

/** Tell the bot the install was declined, the way OAuth does (`error=access_denied`). */
export const DeclineInstall = Command.define("DeclineInstall", {
	args: { redirectUri: Schema.String, state: Schema.String },
	messages: [Message.LeftPage],
	execute: ({ redirectUri, state }) =>
		load(installRedirectUrl(redirectUri, { error: "access_denied", state })).pipe(
			Effect.as(Message.LeftPage()),
		),
})

/** Sign in, then come back to this link. */
export const RedirectToBotInstallSignIn = Command.define("RedirectToBotInstallSignIn", {
	args: { returnTo: Schema.String },
	messages: [Message.LeftPage],
	execute: ({ returnTo }) => load(signInHref(returnTo)).pipe(Effect.as(Message.LeftPage())),
})
