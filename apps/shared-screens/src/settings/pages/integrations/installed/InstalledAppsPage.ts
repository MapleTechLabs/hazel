// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/settings/integrations/installed` (`web-foldkit/src/page/settings/integrations/installed`,
 * now deleted): the bots installed in the workspace, each uninstalled after a confirm on its card;
 * "Install by ID" opens its modal. An integration's own bot (Maple) is managed on its page instead.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { BotId, OrganizationId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Schema } from "effect"
import { Navigate, OpenModal, ShowToast } from "../../../../app/requests"
import { Session } from "../../../../app/session"
import { CommonReason, copyOf, errorToast, reasonOf, successToast } from "../../../../modals/feedback"
import { botCard, pageHeader } from "../../../integrations/cards"
import { Bot, installedBotsStream } from "../../../integrations/data"

/** What can go wrong uninstalling a bot, beyond the shared reasons. */
export const UninstallFailure = Schema.Union([
	Schema.Literals(["NotFound", "NoActiveOrganization"]),
	CommonReason,
])
export type UninstallFailure = typeof UninstallFailure.Type

export const InstalledAppsMessage = UiSchema.TaggedEnum({
	UpdatedBots: { bots: Schema.Array(Bot) },
	PressedUninstall: { botId: BotId },
	PressedCancelUninstall: {},
	PressedConfirmUninstall: { botId: BotId },
	SucceededUninstall: { botId: BotId },
	FailedUninstall: { botId: BotId, reason: UninstallFailure },
	PressedBrowseMarketplace: {},
	PressedInstallById: {},
})
export type InstalledAppsMessage = typeof InstalledAppsMessage.Type

export const InstalledAppsProps = Schema.Struct({ orgSlug: Schema.String, session: Session })
export type InstalledAppsProps = typeof InstalledAppsProps.Type

export const InstalledAppsModel = Schema.Struct({
	/** Null until the live query is ready. */
	bots: Schema.NullOr(Schema.Array(Bot)),
	/** The bot whose card asks "Uninstall?" (the first press arms it, the second uninstalls). */
	confirming: Schema.NullOr(BotId),
	/** Bots whose uninstall is in flight; repeats are ignored. */
	uninstalling: Schema.Array(BotId),
})
export type InstalledAppsModel = typeof InstalledAppsModel.Type

/** `bot.uninstall` in the workspace. */
export class UninstallBot extends Command.Service<UninstallBot>()(
	"hazel/settings/integrations/UninstallBot",
	{
		args: { botId: BotId, organizationId: Schema.NullOr(OrganizationId) },
		success: InstalledAppsMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ botId, organizationId }) => {
				const failed = (reason: UninstallFailure) =>
					Effect.succeed(InstalledAppsMessage.FailedUninstall({ botId, reason }))
				return rpc("bot.uninstall", { botId, organizationId: organizationId ?? undefined }).pipe(
					Effect.as(InstalledAppsMessage.SucceededUninstall({ botId })),
					Effect.catchTags({
						BotNotFoundError: () => failed("NotFound"),
						ActiveOrganizationRequiredError: () => failed("NoActiveOrganization"),
					}),
					// BOUNDARY: every other failure is a common reason, never server text.
					Effect.catchCause((cause) => failed(reasonOf(Cause.squash(cause)))),
				)
			}
		}),
	)
}

const InstalledAppsDef = Hazel.component({
	name: "InstalledAppsPage",
	props: InstalledAppsProps,
	model: InstalledAppsModel,
	message: InstalledAppsMessage,
})

const settled = (model: InstalledAppsModel, botId: BotId): InstalledAppsModel => ({
	...model,
	uninstalling: model.uninstalling.filter((id) => id !== botId),
})

export const InstalledAppsPageNoDeps = InstalledAppsDef.make({
	init: () => ({ bots: null, confirming: null, uninstalling: [] }),
	update: {
		UpdatedBots: ($, { bots }) => $.evolve({ bots: () => bots }),
		PressedUninstall: ($, { botId }) =>
			$.model.uninstalling.includes(botId) ? $.model : $.evolve({ confirming: () => botId }),
		PressedCancelUninstall: ($) => $.evolve({ confirming: () => null }),
		PressedConfirmUninstall: ($, { botId }) =>
			$.model.confirming !== botId || $.model.uninstalling.includes(botId)
				? $.model
				: $.set({
						...$.model,
						confirming: null,
						uninstalling: [...$.model.uninstalling, botId],
					}).run(
						UninstallBot.make({
							botId,
							organizationId: $.props.session.organization?.id ?? null,
						}),
					),
		SucceededUninstall: ($, { botId }) =>
			$.set(settled($.model, botId)).run(
				ShowToast.make({ toast: successToast("Application uninstalled successfully") }),
			),
		FailedUninstall: ($, { botId, reason }) =>
			$.set(settled($.model, botId)).run(
				ShowToast.make({
					toast: errorToast(
						copyOf(reason, {
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
			),
		PressedBrowseMarketplace: ($) =>
			$.run(
				Navigate.make({
					href: `/${$.props.orgSlug}/settings/integrations/marketplace`,
					replace: false,
				}),
			),
		PressedInstallById: ($) => $.run(OpenModal.make({ modal: { _tag: "InstallBotById" } })),
	},
	subscriptions: ({ props }) => {
		const { organization } = props.session
		return organization === null
			? []
			: [
					Subscription.make("installedBots", [organization.id], ([org]) =>
						installedBotsStream(org, (bots) => InstalledAppsMessage.UpdatedBots({ bots })),
					),
				]
	},
	view: (h, model) =>
		h.stack
			.key("settings-integrations-installed")
			.density("relaxed")
			.children(
				pageHeader(h, {
					title: "Installed apps",
					subtitle: "Manage applications installed in your workspace.",
					actions: [
						h.button
							.label("Install by ID")
							.icon("plus")
							.variant("outline")
							.on("press", InstalledAppsMessage.PressedInstallById()),
					],
				}),
				model.bots === null
					? h.progress.style("spinner").label("Loading...")
					: model.bots.length === 0
						? h.emptyState
								.icon("robot")
								.title("No installed applications")
								// Integration apps (Maple) are left out of this list, so the empty state says where they are.
								.description(
									"Browse the Marketplace to find and install applications for your workspace. Apps that come with an integration, like Maple, are managed on their page in Integrations.",
								)
								.action(
									h.button
										.label("Browse marketplace")
										.on("press", InstalledAppsMessage.PressedBrowseMarketplace()),
								)
						: h.grid.columns("3").children(
								...model.bots.map((bot) =>
									botCard(h, bot, {
										_tag: "Uninstall",
										state: model.uninstalling.includes(bot.id)
											? "Uninstalling"
											: model.confirming === bot.id
												? "Confirming"
												: "Idle",
										onUninstall: InstalledAppsMessage.PressedUninstall({ botId: bot.id }),
										onConfirm: InstalledAppsMessage.PressedConfirmUninstall({
											botId: bot.id,
										}),
										onCancel: InstalledAppsMessage.PressedCancelUninstall(),
									}),
								),
							),
			),
})

/** The page with its uninstall Command on the host's `HazelRpc`. */
export const InstalledAppsPage = InstalledAppsPageNoDeps.pipe(Component.provide(UninstallBot.layer))
