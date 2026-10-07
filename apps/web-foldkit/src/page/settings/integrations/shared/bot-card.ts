import type { IntegrationConnection } from "@hazel/domain/models"
import type { Html, HtmlBuilder } from "foldkit/html"
import { getIntegrationIconUrl, groupScopesByResource, INTEGRATION_PROVIDERS } from "~/lib/bot-scopes"
import { IconArrowPath, IconCheck, IconDotsVertical, IconDownload, IconEdit, IconTrash } from "../../../../icons"
import { avatar } from "../../../../ui/avatar"
import { badge } from "../../../../ui/badge"
import { button } from "../../../../ui/button"
import * as Menu from "../../../../ui/menu"
import { menuLabel, menuTriggerClassName, view as menuView } from "../../../../ui/menu-view"
import type { Bot, PublicBot } from "./bots"

/** Ports of `components/bots/bot-card.tsx` and `marketplace-bot-card.tsx`. */

const isProvider = (provider: string): provider is IntegrationConnection.IntegrationProvider =>
	provider in INTEGRATION_PROVIDERS

/** `BotAvatar`: the machine user's avatar, else the facehash of the name. */
const botAvatar = <Message>(h: HtmlBuilder<Message>, bot: Bot, size: "md" | "lg") =>
	avatar(h, {
		size,
		src: bot.avatarUrl,
		seed: bot.name || "bot",
		alt: bot.name ? `${bot.name} avatar` : "Bot avatar",
		className: "shrink-0",
	})

/** The scope chips and integration icons under the header. */
const permissions = <Message>(h: HtmlBuilder<Message>, bot: Bot): ReadonlyArray<Html> =>
	bot.scopes.length > 0
		? [
				h.div(
					[h.Class("flex flex-wrap gap-1")],
					[
						...Object.entries(groupScopesByResource(bot.scopes)).map(([resource, actions]) =>
							h.span(
								[
									h.Class(
										"inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-fg",
									),
								],
								[
									h.span([h.Class("capitalize")], [resource]),
									h.span([h.Class("mx-0.5 opacity-50")], ["·"]),
									h.span([h.Class("capitalize")], [actions.join(", ")]),
								],
							),
						),
						...bot.allowedIntegrations.filter(isProvider).map((provider) =>
							h.span(
								[h.Class("inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5")],
								[
									h.img([
										h.Attribute("src", getIntegrationIconUrl(provider, 32)),
										h.Attribute("alt", INTEGRATION_PROVIDERS[provider].label),
										h.Attribute("title", INTEGRATION_PROVIDERS[provider].label),
										h.Class("size-3 rounded-sm"),
									]),
								],
							),
						),
					],
				),
			]
		: []

const CARD_CLASS =
	"flex h-full flex-col overflow-hidden rounded-xl border border-border bg-bg transition-all duration-200 hover:border-border-hover hover:shadow-md"

export const BOT_MENU_ENTRIES: ReadonlyArray<Menu.Entry> = [
	Menu.item("edit"),
	Menu.item("regenerate"),
	Menu.separator,
	Menu.item("delete", { intent: "Danger" }),
]

export const botMenuId = (botId: string) => `bot-actions-${botId}`

/** The card's actions: the "Bot actions" menu (your apps) or an Uninstall footer (installed). */
export type BotCardActions<Message> =
	| {
			readonly _tag: "Menu"
			readonly menu: Menu.Model
			readonly toMenuMessage: (message: Menu.Message) => Message
	  }
	| { readonly _tag: "Uninstall"; readonly onUninstall: Message }

const actionsMenu = <Message>(
	h: HtmlBuilder<Message>,
	menu: Menu.Model,
	toMenuMessage: (message: Menu.Message) => Message,
): Html => {
	const isOpen = menu.popup._tag === "Open"
	const label = (key: string, text: string) => menuLabel(h, menu.id, key, text)
	const content: Record<string, () => ReadonlyArray<Html>> = {
		edit: () => [IconEdit(h, { className: "size-4" }), label("edit", "Edit")],
		regenerate: () => [IconArrowPath(h, { className: "size-4" }), label("regenerate", "Regenerate Token")],
		delete: () => [IconTrash(h, { className: "size-4" }), label("delete", "Delete")],
	}
	return h.submodel({
		slotId: menu.id,
		model: menu,
		view: menuView,
		viewInputs: {
			// MenuTrigger renders a button around the Button and hands both the trigger props.
			toTrigger: (attributes, overlay) =>
				h.button(
					[
						...attributes,
						h.AriaLabel("Bot actions"),
						h.Class(menuTriggerClassName()),
						h.DataAttribute("react-aria-pressable", "true"),
						h.DataAttribute("slot", "menu-trigger"),
						h.Tabindex(0),
						h.Type("button"),
					],
					[
						button(
							h,
							{
								size: "sm",
								intent: "plain",
								className: "size-8 p-0 hover:bg-secondary",
								attributes: [
									h.AriaLabel("Bot actions"),
									h.Attribute("aria-haspopup", "true"),
									h.Attribute("aria-expanded", isOpen ? "true" : "false"),
									...(isOpen
										? [
												h.Attribute("aria-controls", Menu.menuId(menu.id)),
												h.DataAttribute("pressed", "true"),
											]
										: []),
								],
							},
							[IconDotsVertical(h, { className: "size-4" })],
						),
						overlay,
					],
				),
			content: (key) => content[key]?.() ?? [],
		},
		toParentMessage: toMenuMessage,
	})
}

export const botCard = <Message>(h: HtmlBuilder<Message>, bot: Bot, actions: BotCardActions<Message>): Html =>
	h.keyed("div")(
		bot.id,
		[h.Class(CARD_CLASS)],
		[
			h.div(
				[h.Class("flex items-start gap-3 p-4")],
				[
					botAvatar(h, bot, "md"),
					h.div(
						[h.Class("flex flex-1 flex-col gap-0.5 min-w-0")],
						[
							h.div(
								[h.Class("flex items-center gap-2")],
								[
									h.h3([h.Class("font-semibold text-fg text-sm truncate")], [bot.name]),
									...(bot.isPublic ? [badge(h, { intent: "secondary", size: "sm" }, ["Public"])] : []),
								],
							),
							h.p(
								[h.Class("line-clamp-2 text-muted-fg text-xs min-h-[2rem]")],
								[bot.description || "No description"],
							),
						],
					),
					...(actions._tag === "Menu" ? [actionsMenu(h, actions.menu, actions.toMenuMessage)] : []),
				],
			),
			h.div([h.Class("px-4 pb-4")], [...permissions(h, bot)]),
			...(actions._tag === "Uninstall"
				? [
						h.div(
							[
								h.Class(
									"flex items-center justify-end border-border border-t bg-muted/20 px-4 py-2.5 mt-auto",
								),
							],
							[button(h, { size: "sm", intent: "outline", onPress: actions.onUninstall }, ["Uninstall"])],
						),
					]
				: []),
		],
	)

export const marketplaceBotCard = <Message>(
	h: HtmlBuilder<Message>,
	bot: PublicBot,
	options: { readonly isInstalled: boolean; readonly isInstalling: boolean; readonly onInstall: Message },
): Html =>
	h.keyed("div")(
		bot.id,
		[h.Class(CARD_CLASS)],
		[
			h.div(
				[h.Class("flex items-start gap-3 p-4")],
				[
					botAvatar(h, bot, "lg"),
					h.div(
						[h.Class("flex flex-1 flex-col gap-0.5 min-w-0")],
						[
							h.h3([h.Class("font-semibold text-fg text-sm truncate")], [bot.name]),
							h.p([h.Class("text-muted-fg text-xs truncate")], ["by ", bot.creatorName]),
						],
					),
				],
			),
			h.div(
				[h.Class("px-4")],
				[
					h.p(
						[h.Class("line-clamp-2 text-muted-fg text-sm leading-relaxed min-h-[2.5rem]")],
						[bot.description || "No description provided"],
					),
				],
			),
			h.div([h.Class("flex-1 px-4 py-3")], [...permissions(h, bot)]),
			h.div(
				[h.Class("flex items-center justify-between border-border border-t bg-muted/20 px-4 py-3 mt-auto")],
				[
					h.span(
						[h.Class("flex items-center gap-1.5 text-muted-fg text-xs")],
						[IconDownload(h, { className: "size-3.5" }), bot.installCount.toLocaleString()],
					),
					options.isInstalled
						? button(h, { intent: "outline", size: "sm", isDisabled: true, className: "gap-1.5" }, [
								IconCheck(h, { className: "size-3.5" }),
								"Installed",
							])
						: button(
								h,
								{
									intent: "primary",
									size: "sm",
									onPress: options.onInstall,
									isDisabled: options.isInstalling,
								},
								[options.isInstalling ? "Installing..." : "Install"],
							),
				],
			),
		],
	)
