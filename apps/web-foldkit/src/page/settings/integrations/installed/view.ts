import { Submodel } from "foldkit"
import { IconPlus, IconRobot } from "../../../../icons"
import { button } from "../../../../ui/button"
import { emptyState } from "../../../../ui/empty-state"
import { loadingState } from "../../../../ui/loader"
import { pageHeader } from "../../../../ui/page-header"
import type { PageViewInputs } from "../../../contract"
import { botCard } from "../shared/bot-card"
import { fragment } from "../shared/view"
import { Message } from "./message"
import type { Model } from "./model"

/** Port of `routes/_app/$orgSlug/settings/integrations/installed.tsx`. */
export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) =>
	fragment(h, [
		pageHeader(h, {
			title: "Installed Apps",
			subtitle: "Manage applications installed in your workspace.",
			size: "title",
			actions: [
				button(h, { intent: "outline", onPress: Message.ClickedInstallById() }, [
					IconPlus(h, { attributes: { "data-slot": "icon" } }),
					"Install by ID",
				]),
			],
		}),
		model.bots === null
			? loadingState(h)
			: model.bots.length === 0
				? emptyState(h, {
						icon: (className) => IconRobot(h, { className }),
						title: "No installed applications",
						// Integration apps (Maple) are left out of this list, so the empty state says where they are.
						description:
							"Browse the Marketplace to find and install applications for your workspace. Apps that come with an integration, like Maple, are managed on their page in Integrations.",
						action: button(
							h,
							{ intent: "primary", onPress: Message.ClickedBrowseMarketplace() },
							["Browse Marketplace"],
						),
					})
				: h.div(
						[h.Class("grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3")],
						model.bots.map((bot) =>
							botCard(h, bot, {
								_tag: "Uninstall",
								onUninstall: Message.ClickedUninstall({ botId: bot.id }),
							}),
						),
					),
	]),
)
