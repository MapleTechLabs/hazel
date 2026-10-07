import { BotId } from "@hazel/schema"
import { Effect, Exit } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { HazelRpc } from "../../../../rpc"
import type { RouteOf } from "../../../../route"
import type { PageReturn } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { failureToast, rateLimitHandler, successToast } from "../shared/exit-toast"
import { Message } from "./message"
import type { Model } from "./model"

/** `uninstallBotMutation` with the toasts of `handleUninstall`. */
export const UninstallBot = Command.define("IntegrationsUninstallBot", {
	args: { botId: BotId },
	messages: [Message.SucceededUninstallBot, Message.FailedUninstallBot],
	execute: ({ botId }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(client("bot.uninstall", { botId }))
			return Exit.isSuccess(exit)
				? Message.SucceededUninstallBot()
				: Message.FailedUninstallBot({
						toast: failureToast(exit.cause, {
							BotNotFoundError: () => ({
								title: "Application not found",
								description: "This application may have already been uninstalled.",
								isRetryable: false,
							}),
							RateLimitExceededError: rateLimitHandler,
						}),
					})
		}),
})

type Return = PageReturn<Model, Message>

export const init = (route: RouteOf<"SettingsIntegrationsInstalled">): Return => ({
	model: { orgSlug: route.orgSlug, bots: null },
})

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		UpdatedBots: ({ bots }) => ({ model: modifyFields(model, { bots: () => bots }) }),
		ClickedUninstall: ({ botId }) => ({ model, commands: [UninstallBot({ botId })] }),
		SucceededUninstallBot: () => ({
			model,
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast("Application uninstalled successfully"),
			}),
		}),
		FailedUninstallBot: ({ toast }) => ({ model, outMessage: PageOutMessage.RequestedToast({ toast }) }),
		ClickedBrowseMarketplace: () => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({
				href: `/${model.orgSlug}/settings/integrations/marketplace`,
				replace: false,
			}),
		}),
	})
