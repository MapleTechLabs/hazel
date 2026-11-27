// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/settings/integrations/marketplace` (`web-foldkit/src/page/settings/integrations/marketplace`,
 * now deleted): the public bots, searchable by name or description, each installed in one press.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { BotId, OrganizationId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Schema } from "effect"
import { ShowToast } from "../../../../app/requests"
import { Session } from "../../../../app/session"
import { CommonReason, copyOf, errorToast, reasonOf, successToast } from "../../../../modals/feedback"
import { marketplaceBotCard, pageHeader } from "../../../integrations/cards"
import { installedBotIdsStream, PublicBot, publicBotsStream } from "../../../integrations/data"

/** What can go wrong installing a bot, beyond the shared reasons. */
export const InstallFailure = Schema.Union([
	Schema.Literals(["NotFound", "AlreadyInstalled", "NoActiveOrganization"]),
	CommonReason,
])
export type InstallFailure = typeof InstallFailure.Type

export const MarketplaceMessage = UiSchema.TaggedEnum({
	UpdatedBots: { bots: Schema.Array(PublicBot) },
	UpdatedInstalled: { botIds: Schema.Array(BotId) },
	ChangedSearch: { payload: TextField.ChangePayload },
	PressedInstall: { botId: BotId },
	SucceededInstall: { botId: BotId },
	FailedInstall: { botId: BotId, reason: InstallFailure },
})
export type MarketplaceMessage = typeof MarketplaceMessage.Type

export const MarketplaceProps = Schema.Struct({ session: Session })
export type MarketplaceProps = typeof MarketplaceProps.Type

export const MarketplaceModel = Schema.Struct({
	search: TextField.State,
	/** Null until the public bots query is ready. */
	bots: Schema.NullOr(Schema.Array(PublicBot)),
	installed: Schema.Array(BotId),
	installing: Schema.Array(BotId),
})
export type MarketplaceModel = typeof MarketplaceModel.Type

/** `bot.install` in the workspace. */
export class InstallBot extends Command.Service<InstallBot>()("hazel/settings/integrations/InstallBot", {
	args: { botId: BotId, organizationId: Schema.NullOr(OrganizationId) },
	success: MarketplaceMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ botId, organizationId }) => {
				const failed = (reason: InstallFailure) =>
					Effect.succeed(MarketplaceMessage.FailedInstall({ botId, reason }))
				return rpc("bot.install", { botId, organizationId: organizationId ?? undefined }).pipe(
					Effect.as(MarketplaceMessage.SucceededInstall({ botId })),
					Effect.catchTags({
						BotNotFoundError: () => failed("NotFound"),
						BotAlreadyInstalledError: () => failed("AlreadyInstalled"),
						ActiveOrganizationRequiredError: () => failed("NoActiveOrganization"),
					}),
					// BOUNDARY: every other failure is a common reason, never server text.
					Effect.catchCause((cause) => failed(reasonOf(Cause.squash(cause)))),
				)
			}
		}),
	)
}

/** By name or description, as today's (deferred) search. */
export const matching = (bots: ReadonlyArray<PublicBot>, search: string): ReadonlyArray<PublicBot> => {
	const query = search.toLowerCase()
	return query === ""
		? bots
		: bots.filter(
				(bot) =>
					bot.name.toLowerCase().includes(query) ||
					(bot.description?.toLowerCase().includes(query) ?? false),
			)
}

const MarketplaceDef = Hazel.component({
	name: "MarketplacePage",
	props: MarketplaceProps,
	model: MarketplaceModel,
	message: MarketplaceMessage,
})

const doneInstalling = (model: MarketplaceModel, botId: BotId): MarketplaceModel => ({
	...model,
	installing: model.installing.filter((id) => id !== botId),
})

export const MarketplacePageNoDeps = MarketplaceDef.make({
	init: () => ({ search: TextField.empty, bots: null, installed: [], installing: [] }),
	update: {
		UpdatedBots: ($, { bots }) => $.evolve({ bots: () => bots }),
		UpdatedInstalled: ($, { botIds }) => $.evolve({ installed: () => botIds }),
		ChangedSearch: ($, { payload }) =>
			$.evolve({ search: (search) => TextField.changed(search, payload) }),
		PressedInstall: ($, { botId }) =>
			$.model.installing.includes(botId)
				? $.model
				: $.set({ ...$.model, installing: [...$.model.installing, botId] }).run(
						InstallBot.make({ botId, organizationId: $.props.session.organization?.id ?? null }),
					),
		SucceededInstall: ($, { botId }) =>
			$.set(doneInstalling($.model, botId)).run(
				ShowToast.make({ toast: successToast("Application installed successfully") }),
			),
		FailedInstall: ($, { botId, reason }) =>
			$.set(doneInstalling($.model, botId)).run(
				ShowToast.make({
					toast: errorToast(
						copyOf(reason, {
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
			),
	},
	subscriptions: ({ props }) => {
		const { organization } = props.session
		return [
			Subscription.make("publicBots", [], () =>
				publicBotsStream((bots) => MarketplaceMessage.UpdatedBots({ bots })),
			),
			organization === null
				? null
				: Subscription.make("installed", [organization.id], ([org]) =>
						installedBotIdsStream(org, (botIds) =>
							MarketplaceMessage.UpdatedInstalled({ botIds }),
						),
					),
		]
	},
	view: (h, model) => {
		const bots = model.bots === null ? null : matching(model.bots, model.search.text)
		return h.stack
			.key("settings-integrations-marketplace")
			.density("relaxed")
			.children(
				pageHeader(h, {
					title: "Marketplace",
					subtitle: "Discover and install community applications for your workspace.",
				}),
				// HAZEL-GAP(p5a-search-width): today's field is `max-w-md` (448pt); `regular` is the 256pt box.
				h.searchField
					.placeholder("Search applications...")
					.width("regular")
					.value(model.search)
					.on("change", (payload) => MarketplaceMessage.ChangedSearch({ payload })),
				bots === null
					? h.progress.style("spinner").label("Loading...")
					: bots.length === 0
						? h.emptyState
								.icon("robot")
								.title("No applications found")
								.description(
									model.search.text === ""
										? "Be the first to publish an application to the marketplace!"
										: "Try a different search term",
								)
						: h.grid.columns("3").children(
								...bots.map((bot) =>
									marketplaceBotCard(h, bot, {
										isInstalled: model.installed.includes(bot.id),
										isInstalling: model.installing.includes(bot.id),
										onInstall: MarketplaceMessage.PressedInstall({ botId: bot.id }),
									}),
								),
							),
			)
	},
})

/** The page with its install Command on the host's `HazelRpc`. */
export const MarketplacePage = MarketplacePageNoDeps.pipe(Component.provide(InstallBot.layer))
