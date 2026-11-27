// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/settings/integrations` (`web-foldkit/src/page/settings/integrations/index`, now deleted):
 * every integration by category, each card saying whether the workspace is connected and opening
 * the integration's page; "Request integration" opens the request modal.
 */
import { Component, Query, Subscription, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { OrganizationId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Option, Schema } from "effect"
import { Navigate, OpenModal } from "../../../app/requests"
import { Session } from "../../../app/session"
import { categories, integrations } from "../../integrations/catalog"
import { type IntegrationStatus, integrationCard, pageHeader } from "../../integrations/cards"
import { Connection, connectionsStream } from "../../integrations/data"

export const IntegrationsMessage = UiSchema.TaggedEnum({
	PickedCategory: { categoryId: Schema.String },
	PressedIntegration: { integrationId: Schema.String },
	PressedRequestIntegration: {},
	UpdatedConnections: { connections: Schema.Array(Connection) },
	UpdatedUserConnections: { connections: Schema.Array(Connection) },
})
export type IntegrationsMessage = typeof IntegrationsMessage.Type

export const IntegrationsProps = Schema.Struct({ orgSlug: Schema.String, session: Session })
export type IntegrationsProps = typeof IntegrationsProps.Type

export const IntegrationsModel = Schema.Struct({
	category: Schema.String,
	connections: Schema.Array(Connection),
	/** The member's own connections (T3 Code links are per member). */
	userConnections: Schema.Array(Connection),
})
export type IntegrationsModel = typeof IntegrationsModel.Type

/** Lower-cased names of the workspace's webhooks: OpenStatus and Railway connect by webhook. */
export class ListWebhookNames extends Query.Service<ListWebhookNames>()(
	"hazel/settings/integrations/ListWebhookNames",
	{
		args: { organizationId: OrganizationId },
		success: Schema.Array(Schema.String),
		error: Schema.Never,
		staleTime: "1 minute",
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ organizationId }) =>
				rpc("channelWebhook.listByOrganization", { organizationId }).pipe(
					Effect.map((result) => [...new Set(result.data.map((hook) => hook.name.toLowerCase()))]),
					// BOUNDARY: best effort; without the names those cards just read "Not connected".
					Effect.tapCause((cause) => Effect.logWarning("listing webhooks failed", cause)),
					Effect.catchCause(() => Effect.succeed([])),
				)
		}),
	)
}

/** An active connection (the last row per provider wins), the member's own, or a webhook. */
export const connectedIds = (
	model: IntegrationsModel,
	webhookNames: ReadonlyArray<string>,
): ReadonlySet<string> => {
	const byProvider = new Map<string, Connection>()
	for (const connection of [...model.connections, ...model.userConnections])
		byProvider.set(connection.provider, connection)
	const ids = new Set(webhookNames)
	for (const [provider, connection] of byProvider) if (connection.isActive) ids.add(provider)
	return ids
}

const IntegrationsDef = Hazel.component({
	name: "IntegrationsPage",
	props: IntegrationsProps,
	model: IntegrationsModel,
	message: IntegrationsMessage,
	queries: {
		webhooks: {
			query: ListWebhookNames,
			args: ({ props }) =>
				props.session.organization === null
					? undefined
					: { organizationId: props.session.organization.id },
		},
	},
})

export const IntegrationsPageNoDeps = IntegrationsDef.make({
	init: () => ({ category: "all", connections: [], userConnections: [] }),
	update: {
		PickedCategory: ($, { categoryId }) => $.evolve({ category: () => categoryId }),
		PressedIntegration: ($, { integrationId }) =>
			$.run(
				Navigate.make({
					href: `/${$.props.orgSlug}/settings/integrations/${integrationId}`,
					replace: false,
				}),
			),
		PressedRequestIntegration: ($) => $.run(OpenModal.make({ modal: { _tag: "RequestIntegration" } })),
		UpdatedConnections: ($, { connections }) => $.evolve({ connections: () => connections }),
		UpdatedUserConnections: ($, { connections }) => $.evolve({ userConnections: () => connections }),
	},
	subscriptions: ({ props }) => {
		const { organization, user } = props.session
		if (organization === null) return []
		return [
			Subscription.make("connections", [organization.id], ([org]) =>
				connectionsStream(org, null, (connections) =>
					IntegrationsMessage.UpdatedConnections({ connections }),
				),
			),
			user === null
				? null
				: Subscription.make("userConnections", [organization.id, user.id], ([org, member]) =>
						connectionsStream(org, member, (connections) =>
							IntegrationsMessage.UpdatedUserConnections({ connections }),
						),
					),
		]
	},
	view: (h, model) => {
		const webhooks = Option.getOrElse(
			h.queries.webhooks._tag === "Success" ? Option.some(h.queries.webhooks.value) : Option.none(),
			() => [] as ReadonlyArray<string>,
		)
		const connected = connectedIds(model, webhooks)
		const shown =
			model.category === "all"
				? integrations
				: integrations.filter((integration) => integration.category === model.category)
		const statusOf = (id: string, comingSoon: boolean | undefined): IntegrationStatus =>
			comingSoon === true ? "comingSoon" : connected.has(id) ? "connected" : "disconnected"
		return h.stack
			.key("settings-integrations")
			.density("relaxed")
			.children(
				pageHeader(h, {
					title: "Integrations",
					subtitle: "Connect your favorite tools to your workspace.",
					actions: [
						h.button
							.label("Request integration")
							.icon("plus")
							.variant("secondary")
							.on("press", IntegrationsMessage.PressedRequestIntegration()),
					],
				}),
				// HAZEL-GAP(p5a-filter-gap): today's category buttons sit `gap-1` apart; `tight` is 2pt.
				h.stack
					.axis("horizontal")
					.density("tight")
					.wrap()
					.children(
						...categories.map((category) =>
							h.button
								.key(category.id)
								.label(category.label)
								.variant(model.category === category.id ? "secondary" : "ghost")
								.size("small")
								.on("press", IntegrationsMessage.PickedCategory({ categoryId: category.id })),
						),
					),
				shown.length === 0
					? h.emptyState
							.title("No integrations found")
							.description("No integrations found in this category.")
					: h.grid.columns("2").children(
							...shown.map((integration) =>
								integrationCard(
									h,
									integration,
									statusOf(integration.id, integration.comingSoon),
									IntegrationsMessage.PressedIntegration({
										integrationId: integration.id,
									}),
								),
							),
						),
			)
	},
})

/** The page with its webhook query on the host's `HazelRpc`. */
export const IntegrationsPage = IntegrationsPageNoDeps.pipe(Component.provide(ListWebhookNames.layer))
