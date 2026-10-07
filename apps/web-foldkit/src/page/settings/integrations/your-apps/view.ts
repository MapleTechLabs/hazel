import { Array, Option } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
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
import { botCard, botMenuId } from "../shared/bot-card"
import { fragment, listSpinner } from "../shared/view"
import { Message } from "./message"
import type { Model } from "./model"

/** Port of `routes/_app/$orgSlug/settings/integrations/your-apps.tsx`. */

// The create modal is root-owned and has no ModalRequest variant yet.
const createButton = (h: HtmlBuilder<Message>, size?: "md"): Html =>
	button(h, size === "md" ? { intent: "primary", size, className: "shrink-0" } : { intent: "primary" }, [
		IconPlus(h, { attributes: { "data-slot": "icon" } }),
		"Create Application",
	])

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) =>
	fragment(h, [
		sectionHeaderRoot(h, { className: "border-none pb-0" }, [
			sectionHeaderGroup(h, {}, [
				h.div(
					[h.Class("flex flex-1 flex-col justify-center gap-1")],
					[
						sectionHeaderHeading(h, {}, ["Your Apps"]),
						sectionHeaderSubheading(h, {}, [
							"Create and manage your own applications to automate tasks and integrate with external services.",
						]),
					],
				),
				createButton(h, "md"),
			]),
		]),
		model.bots === null
			? listSpinner(h)
			: model.bots.length === 0
				? emptyState(h, {
						icon: (className) => IconRobot(h, { className }),
						title: "No applications yet",
						description:
							"Create your first application to automate tasks and integrate with external services.",
						action: createButton(h),
					})
				: h.div(
						[h.Class("grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3")],
						model.bots.flatMap((bot) =>
							Option.match(
								Array.findFirst(model.menus, (menu) => menu.id === botMenuId(bot.id)),
								{
									onNone: () => [],
									onSome: (menu) => [
										botCard(h, bot, {
											_tag: "Menu",
											menu,
											toMenuMessage: (message) =>
												Message.GotMenuMessage({ botId: bot.id, message }),
										}),
									],
								},
							),
						),
					),
	]),
)
