import { Submodel } from "foldkit"
import { IconPlus, IconRobot } from "../../../../icons"
import { button } from "../../../../ui/button"
import { emptyState } from "../../../../ui/empty-state"
import {
	sectionHeaderGroup,
	sectionHeaderHeading,
	sectionHeaderRoot,
	sectionHeaderSubheading,
} from "../../../../ui/section-header"
import type { PageViewInputs } from "../../../contract"
import { botCard } from "../shared/bot-card"
import { fragment, listSpinner } from "../shared/view"
import { Message } from "./message"
import type { Model } from "./model"

/** Port of `routes/_app/$orgSlug/settings/integrations/installed.tsx`. */
export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) =>
	fragment(h, [
		sectionHeaderRoot(h, { className: "border-none pb-0" }, [
			sectionHeaderGroup(h, {}, [
				h.div(
					[h.Class("flex flex-1 flex-col justify-center gap-1")],
					[
						sectionHeaderHeading(h, {}, ["Installed Apps"]),
						sectionHeaderSubheading(h, {}, ["Manage applications installed in your workspace."]),
					],
				),
				// The "Install by ID" modal is root-owned and has no ModalRequest variant yet.
				button(h, { intent: "outline" }, [IconPlus(h, { className: "size-4" }), "Install by ID"]),
			]),
		]),
		model.bots === null
			? listSpinner(h)
			: model.bots.length === 0
				? emptyState(h, {
						icon: (className) => IconRobot(h, { className }),
						title: "No installed applications",
						description:
							"Browse the Marketplace to find and install applications for your workspace.",
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
