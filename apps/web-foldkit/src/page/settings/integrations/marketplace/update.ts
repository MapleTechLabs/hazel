import { BotId, OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../../../ui/aria/interaction"
import { HazelRpc } from "../../../../rpc"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { catchCommon, errorToastOf, successToast } from "../../../../data/actions"
import type { PageSubscriptionInput } from "../../../contract"
import { failureMessage } from "~/lib/error-messages"
import { Message } from "./message"
import type { Model } from "./model"

/** `installBotMutation` */
export const InstallBot = Command.define("InstallBot", {
	args: { botId: BotId, organizationId: Schema.NullOr(OrganizationId) },
	messages: [Message.SucceededInstallBot, Message.FailedInstallBot],
	execute: ({ botId, organizationId }) =>
		HazelRpc.use((rpc) =>
			rpc("bot.install", { botId, organizationId: organizationId ?? undefined }),
		).pipe(
			Effect.as(Message.SucceededInstallBot({ botId })),
			Effect.catchTags({
				BotNotFoundError: () =>
					Effect.succeed(Message.FailedInstallBot({ botId, reason: "NotFound" })),
				BotAlreadyInstalledError: () =>
					Effect.succeed(Message.FailedInstallBot({ botId, reason: "AlreadyInstalled" })),
				ActiveOrganizationRequiredError: () =>
					Effect.succeed(Message.FailedInstallBot({ botId, reason: "NoActiveOrganization" })),
			}),
			catchCommon((reason) => Message.FailedInstallBot({ botId, reason })),
		),
})

type Return = PageReturn<Model, Message>

export const interaction = Interaction.embed<Model, Message, PageSubscriptionInput<Model>>(
	(message) => Message.GotInteractionMessage({ message }),
	(input) => input.model,
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

export const update = (model: Model, message: Message, shared: Shared): Return =>
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
						commands: [InstallBot({ botId, organizationId: shared.organization?.id ?? null })],
					},
		SucceededInstallBot: ({ botId }) => ({
			model: doneInstalling(model, botId),
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast("Application installed successfully"),
			}),
		}),
		FailedInstallBot: ({ botId, reason }) => ({
			model: doneInstalling(model, botId),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: "Application not found",
							description: "This application may no longer be available.",
						},
						AlreadyInstalled: {
							title: "Already installed",
							description: "This application is already installed in your workspace.",
						},
						NoActiveOrganization: {
							title: "No workspace selected",
							description: "Open a workspace and try again.",
						},
					}),
				),
			}),
		}),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})
