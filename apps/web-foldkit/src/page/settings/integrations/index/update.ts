import { Effect } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { HazelRpc } from "../../../../rpc"
import type { RouteOf } from "../../../../route"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { Message } from "./message"
import type { Model } from "./model"

/** `listOrganizationWebhooksMutation({ payload: {} })`, once the user's organization is known. */
export const ListOrganizationWebhooks = Command.define("IntegrationsListOrganizationWebhooks", {
	args: {},
	messages: [Message.SucceededListWebhooks, Message.FailedListWebhooks],
	execute: () =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("channelWebhook.listByOrganization", {})
			return Message.SucceededListWebhooks({ names: result.data.map((webhook) => webhook.name) })
		}).pipe(Effect.catch(() => Effect.succeed(Message.FailedListWebhooks()))),
})

const requestWebhooksOnce = (model: Model, shared: Shared): PageReturn<Model, Message> =>
	model.hasRequestedWebhooks || !shared.currentUser?.organizationId
		? { model }
		: {
				model: modifyFields(model, { hasRequestedWebhooks: () => true }),
				commands: [ListOrganizationWebhooks({})],
			}

export const init = (
	route: RouteOf<"SettingsIntegrations">,
	shared: Shared,
): PageReturn<Model, Message> =>
	requestWebhooksOnce(
		{
			orgSlug: route.orgSlug,
			selectedCategory: "all",
			connections: [],
			webhookProviders: [],
			hasRequestedWebhooks: false,
		},
		shared,
	)

export const sharedChanged = (model: Model, shared: Shared) => requestWebhooksOnce(model, shared)

export const update = (model: Model, message: Message): PageReturn<Model, Message> =>
	Message.match<PageReturn<Model, Message>>(message, {
		ClickedCategory: ({ categoryId }) => ({
			model: modifyFields(model, { selectedCategory: () => categoryId }),
		}),
		ClickedIntegration: ({ integrationId }) => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({
				href: `/${model.orgSlug}/settings/integrations/${integrationId}`,
				replace: false,
			}),
		}),
		UpdatedConnections: ({ connections }) => ({
			model: modifyFields(model, { connections: () => connections }),
		}),
		SucceededListWebhooks: ({ names }) => ({
			model: modifyFields(model, {
				webhookProviders: () => Array.from(new Set(names.map((name) => name.toLowerCase()))),
			}),
		}),
		FailedListWebhooks: () => ({ model }),
	})

