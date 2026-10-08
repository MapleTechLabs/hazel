import { BotId } from "@hazel/schema"
import { Effect, Exit } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../../../ui/aria/interaction"
import { HazelRpc } from "../../../../rpc"
import type { PageReturn } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { embedInteraction } from "../shared/interaction"
import { failureToast, rateLimitHandler, successToast } from "../shared/exit-toast"
import { Message } from "./message"
import type { Model } from "./model"

/** `installBotMutation` with the toasts of `handleInstall`. */
export const InstallBot = Command.define("IntegrationsInstallBot", {
	args: { botId: BotId },
	messages: [Message.SucceededInstallBot, Message.FailedInstallBot],
	execute: ({ botId }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(client("bot.install", { botId }))
			return Exit.isSuccess(exit)
				? Message.SucceededInstallBot({ botId })
				: Message.FailedInstallBot({
						botId,
						toast: failureToast(exit.cause, {
							BotNotFoundError: () => ({
								title: "Application not found",
								description: "This application may no longer be available.",
								isRetryable: false,
							}),
							BotAlreadyInstalledError: () => ({
								title: "Already installed",
								description: "This application is already installed in your workspace.",
								isRetryable: false,
							}),
							RateLimitExceededError: rateLimitHandler,
						}),
					})
		}),
})

type Return = PageReturn<Model, Message>

export const interaction = embedInteraction<Model, Message>((message) =>
	Message.GotInteractionMessage({ message }),
)

/** The interaction target of a bot card's Install button. */
export const installTarget = (botId: BotId) => `install-${botId}`

export const init = (): Return => ({
	model: {
		search: "",
		bots: null,
		installedBotIds: [],
		installingBotIds: [],
		interaction: Interaction.init(),
	},
})

const doneInstalling = (model: Model, botId: BotId) =>
	modifyFields(model, { installingBotIds: (ids) => ids.filter((id) => id !== botId) })

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		UpdatedPublicBots: ({ bots }) => ({ model: modifyFields(model, { bots: () => bots }) }),
		UpdatedInstalledBotIds: ({ botIds }) => ({
			model: modifyFields(model, { installedBotIds: () => botIds }),
		}),
		ChangedSearch: ({ search }) => ({ model: modifyFields(model, { search: () => search }) }),
		ClickedInstall: ({ botId }) =>
			model.installingBotIds.includes(botId)
				? { model }
				: {
						model: modifyFields(model, {
							installingBotIds: (ids) => [...ids, botId],
							interaction: (state) =>
								Interaction.disabledTargets(state, [installTarget(botId)]),
						}),
						commands: [InstallBot({ botId })],
					},
		SucceededInstallBot: ({ botId }) => ({
			model: doneInstalling(model, botId),
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast("Application installed successfully"),
			}),
		}),
		FailedInstallBot: ({ botId, toast }) => ({
			model: doneInstalling(model, botId),
			outMessage: PageOutMessage.RequestedToast({ toast }),
		}),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})
