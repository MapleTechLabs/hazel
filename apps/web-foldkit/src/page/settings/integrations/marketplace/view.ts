import { Submodel } from "foldkit"
import { IconMagnifier3, IconRobot } from "../../../../icons"
import { emptyState } from "../../../../ui/empty-state"
import { input, inputGroup } from "../../../../ui/input"
import { loadingState } from "../../../../ui/loader"
import { pageHeader } from "../../../../ui/page-header"
import type { PageViewInputs } from "../../../contract"
import { marketplaceBotCard } from "../shared/bot-card"
import type { PublicBot } from "../shared/bots"
import { fragment } from "../shared/view"
import { Message } from "./message"
import { installTarget, interaction } from "./update"
import type { Model } from "./model"

/** Port of `routes/_app/$orgSlug/settings/integrations/marketplace.tsx`. */

/** Filters by name or description, like the legacy (deferred) search. */
const matching = (bots: ReadonlyArray<PublicBot>, search: string) => {
	if (!search) return bots
	const searchLower = search.toLowerCase()
	return bots.filter(
		(bot) =>
			bot.name.toLowerCase().includes(searchLower) ||
			bot.description?.toLowerCase().includes(searchLower),
	)
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) => {
	const bots = model.bots === null ? null : matching(model.bots, model.search)
	const wiring = interaction.wiring(model)
	return fragment(h, [
		pageHeader(h, {
			title: "Marketplace",
			subtitle: "Discover and install community applications for your workspace.",
			size: "title",
		}),
		h.div(
			[h.Class("flex flex-col gap-6")],
			[
				inputGroup(h, { className: "max-w-md", interaction: { wiring, target: "search-group" } }, [
					IconMagnifier3(h, { attributes: { "data-slot": "icon" } }),
					input(h, {
						placeholder: "Search applications...",
						interaction: { wiring, target: "search" },
						attributes: [
							h.Value(model.search),
							h.OnInput((search) => Message.ChangedSearch({ search })),
						],
					}),
				]),
				bots === null
					? loadingState(h)
					: bots.length === 0
						? emptyState(h, {
								icon: (className) => IconRobot(h, { className }),
								title: "No applications found",
								description: model.search
									? "Try a different search term"
									: "Be the first to publish an application to the marketplace!",
							})
						: h.div(
								[h.Class("grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3")],
								bots.map((bot) =>
									marketplaceBotCard(h, bot, {
										isInstalled: model.installedBotIds.includes(bot.id),
										isInstalling: model.installingBotIds.includes(bot.id),
										onInstall: Message.ClickedInstall({ botId: bot.id }),
										installInteraction: { wiring, target: installTarget(bot.id) },
									}),
								),
							),
			],
		),
	])
})
