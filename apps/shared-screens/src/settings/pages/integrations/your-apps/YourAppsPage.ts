// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/settings/integrations/your-apps` (`web-foldkit/src/page/settings/integrations/your-apps`,
 * now deleted): the bots the user made, each with a menu to edit it, regenerate its token or delete
 * it (each a modal of the app's); "Create application" opens the create modal.
 */
import { Subscription, UiSchema } from "@effect/ui"
import { BotId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { type ModalRequest, OpenModal } from "../../../../app/requests"
import { Session } from "../../../../app/session"
import { botCard, pageHeader } from "../../../integrations/cards"
import { Bot, myBotsStream } from "../../../integrations/data"

export const YourAppsMessage = UiSchema.TaggedEnum({
	UpdatedBots: { bots: Schema.Array(Bot) },
	SelectedBotAction: { botId: BotId, action: Schema.String },
	PressedCreateApplication: {},
})
export type YourAppsMessage = typeof YourAppsMessage.Type

export const YourAppsProps = Schema.Struct({ session: Session })
export type YourAppsProps = typeof YourAppsProps.Type

export const YourAppsModel = Schema.Struct({
	/** Null until the live query is ready. */
	bots: Schema.NullOr(Schema.Array(Bot)),
})
export type YourAppsModel = typeof YourAppsModel.Type

/** The modal a menu entry opens for its bot (the app's `EditBot`, `RegenerateBotToken`, `DeleteBot`). */
export const modalFor = (bot: Bot, action: string): ModalRequest | null =>
	action === "edit"
		? {
				_tag: "EditBot",
				id: bot.id,
				name: bot.name,
				description: bot.description,
				isPublic: bot.isPublic,
				scopes: bot.scopes,
				allowedIntegrations: bot.allowedIntegrations,
				installRedirectUris: bot.installRedirectUris,
				avatarUrl: bot.avatarUrl,
			}
		: action === "regenerate"
			? { _tag: "RegenerateBotToken", botId: bot.id, botName: bot.name }
			: action === "delete"
				? { _tag: "DeleteBot", botId: bot.id, botName: bot.name }
				: null

const YourAppsDef = Hazel.component({
	name: "YourAppsPage",
	props: YourAppsProps,
	model: YourAppsModel,
	message: YourAppsMessage,
})

type H = Parameters<Parameters<typeof YourAppsDef.make>[0]["view"]>[0]

const createButton = (h: H) =>
	h.button.label("Create application").icon("plus").on("press", YourAppsMessage.PressedCreateApplication())

export const YourAppsPage = YourAppsDef.make({
	init: () => ({ bots: null }),
	update: {
		UpdatedBots: ($, { bots }) => $.evolve({ bots: () => bots }),
		SelectedBotAction: ($, { botId, action }) => {
			const bot = $.model.bots?.find((candidate) => candidate.id === botId)
			const modal = bot === undefined ? null : modalFor(bot, action)
			return modal === null ? $.model : $.run(OpenModal.make({ modal }))
		},
		PressedCreateApplication: ($) => $.run(OpenModal.make({ modal: { _tag: "CreateBot" } })),
	},
	subscriptions: ({ props }) => {
		const { user } = props.session
		return user === null
			? []
			: [
					Subscription.make("myBots", [user.id], ([userId]) =>
						myBotsStream(userId, (bots) => YourAppsMessage.UpdatedBots({ bots })),
					),
				]
	},
	view: (h, model) =>
		h.stack
			.key("settings-integrations-your-apps")
			.density("relaxed")
			.children(
				pageHeader(h, {
					title: "Your apps",
					subtitle:
						"Create and manage your own applications to automate tasks and integrate with external services.",
					actions: [createButton(h)],
				}),
				model.bots === null
					? h.progress.style("spinner").label("Loading...")
					: model.bots.length === 0
						? h.emptyState
								.icon("robot")
								.title("No applications yet")
								.description(
									"Create your first application to automate tasks and integrate with external services.",
								)
								.action(createButton(h))
						: h.grid.columns("3").children(
								...model.bots.map((bot) =>
									botCard(h, bot, {
										_tag: "Menu",
										onSelect: (action) =>
											YourAppsMessage.SelectedBotAction({ botId: bot.id, action }),
									}),
								),
							),
			),
})
