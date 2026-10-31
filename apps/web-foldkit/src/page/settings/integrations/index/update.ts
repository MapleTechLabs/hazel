import { OrganizationId } from "@hazel/schema"
import { Effect } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { HazelRpc } from "../../../../rpc"
import { integrationRoute, type RouteOf } from "../../../../route"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { catchCommon } from "../../../../data/actions"
import { Message } from "./message"
import type { Model } from "./model"

/** `listOrganizationWebhooksMutation`, once the route's organization is known. */
export const ListOrganizationWebhooks = Command.define("ListOrganizationWebhooks", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededListWebhooks, Message.FailedListWebhooks],
	execute: ({ organizationId }) =>
		HazelRpc.use((rpc) => rpc("channelWebhook.listByOrganization", { organizationId })).pipe(
			Effect.map((result) =>
				Message.SucceededListWebhooks({ names: result.data.map((webhook) => webhook.name) }),
			),
			catchCommon((reason) => Message.FailedListWebhooks({ reason })),
		),
})

const requestWebhooksOnce = (model: Model, shared: Shared): PageReturn<Model, Message> => {
	const organizationId = shared.organization?.id
	return model.hasRequestedWebhooks || organizationId === undefined
		? { model }
		: {
				model: modifyFields(model, { hasRequestedWebhooks: () => true }),
				commands: [ListOrganizationWebhooks({ organizationId })],
			}
}

export const init = (route: RouteOf<"SettingsIntegrations">, shared: Shared): PageReturn<Model, Message> =>
	requestWebhooksOnce(
		{
			orgSlug: route.orgSlug,
			selectedCategory: "all",
			connections: [],
			userConnections: [],
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
				route: integrationRoute(model.orgSlug, integrationId),
				replace: false,
			}),
		}),
		UpdatedConnections: ({ connections }) => ({
			model: modifyFields(model, { connections: () => connections }),
		}),
		UpdatedUserConnections: ({ connections }) => ({
			model: modifyFields(model, { userConnections: () => connections }),
		}),
		SucceededListWebhooks: ({ names }) => ({
			model: modifyFields(model, {
				webhookProviders: () => Array.from(new Set(names.map((name) => name.toLowerCase()))),
			}),
		}),
		// Best effort: without the webhook names the OpenStatus and Railway cards just read "not connected".
		FailedListWebhooks: () => ({ model }),
		ClickedRequestIntegration: () => ({
			model,
			outMessage: PageOutMessage.RequestedModal({ modal: { _tag: "RequestIntegration" } }),
		}),
	})
