import { BotId, OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { HazelRpc } from "../../../../rpc"
import { AppRoute, type RouteOf } from "../../../../route"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { catchCommon, errorToastOf, successToast } from "../../../../data/actions"
import { failureMessage } from "~/lib/error-messages"
import { Message } from "./message"
import type { Model } from "./model"

/** `uninstallBotMutation` */
export const UninstallBot = Command.define("UninstallBot", {
	args: { botId: BotId, organizationId: Schema.NullOr(OrganizationId) },
	messages: [Message.SucceededUninstallBot, Message.FailedUninstallBot],
	execute: ({ botId, organizationId }) =>
		HazelRpc.use((rpc) =>
			rpc("bot.uninstall", { botId, organizationId: organizationId ?? undefined }),
		).pipe(
			Effect.as(Message.SucceededUninstallBot({ botId })),
			Effect.catchTags({
				BotNotFoundError: () =>
					Effect.succeed(Message.FailedUninstallBot({ botId, reason: "NotFound" })),
				ActiveOrganizationRequiredError: () =>
					Effect.succeed(Message.FailedUninstallBot({ botId, reason: "NoActiveOrganization" })),
			}),
			catchCommon((reason) => Message.FailedUninstallBot({ botId, reason })),
		),
})

type Return = PageReturn<Model, Message>

export const init = (route: RouteOf<"SettingsIntegrationsInstalled">): Return => ({
	model: { orgSlug: route.orgSlug, bots: null, uninstallingBotIds: [] },
})

const settled = (model: Model, botId: BotId): Model =>
	modifyFields(model, { uninstallingBotIds: (ids) => ids.filter((id) => id !== botId) })

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedBots: ({ bots }) => ({ model: modifyFields(model, { bots: () => bots }) }),
		ClickedUninstall: ({ botId }) =>
			model.uninstallingBotIds.includes(botId)
				? { model }
				: {
						model: modifyFields(model, { uninstallingBotIds: (ids) => [...ids, botId] }),
						commands: [UninstallBot({ botId, organizationId: shared.organization?.id ?? null })],
					},
		SucceededUninstallBot: ({ botId }) => ({
			model: settled(model, botId),
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast("Application uninstalled successfully"),
			}),
		}),
		FailedUninstallBot: ({ botId, reason }) => ({
			model: settled(model, botId),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: "Application not found",
							description: "This application may have already been uninstalled.",
						},
						NoActiveOrganization: {
							title: "No workspace selected",
							description: "Open a workspace and try again.",
						},
					}),
				),
			}),
		}),
		ClickedBrowseMarketplace: () => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({
				route: AppRoute.SettingsIntegrationsMarketplace({ orgSlug: model.orgSlug }),
				replace: false,
			}),
		}),
		ClickedInstallById: () => ({
			model,
			outMessage: PageOutMessage.RequestedModal({ modal: { _tag: "InstallBotById" } }),
		}),
	})
