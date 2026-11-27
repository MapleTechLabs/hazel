// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The integrations pages' pieces, as view functions over plain props (`web-foldkit/src/page/settings/
 * integrations/shared/{view,bot-card}.ts`): the page header, an integration's card, a bot's card in
 * Your apps and Installed apps, and a public bot's card in the Marketplace.
 */
import type { Hazel, TextTone } from "@hazel/ui/vocabulary/index"
import type { MenuGroups } from "@hazel/ui/vocabulary/content"
import type { Bot, PublicBot } from "./data"
import { type Integration, integrationLogoSrc } from "./catalog"
import { groupScopesByResource } from "./scopes"

type H<Msg> = Hazel.H<Msg>

/** CSS `capitalize`, as today's chips draw a scope: each hyphenated part too (`Message-Reactions`). */
const capitalize = (words: string) =>
	words.replace(
		/(^|[-\s])(\p{L})/gu,
		(_, start: string, letter: string) => `${start}${letter.toUpperCase()}`,
	)

/**
 * A settings tab's header (`pageHeader` size `title`): the title over a muted line, actions at the end.
 * HAZEL-GAP(p4-screen-page-column): no `screen` surface draws a page column's header; this composes it.
 * HAZEL-GAP(p5a-header-wrap): today the actions wrap under the title on a phone; this row never wraps.
 */
export const pageHeader = <Msg>(
	h: H<Msg>,
	options: Readonly<{ title: string; subtitle: string; actions?: ReadonlyArray<unknown> }>,
) =>
	h.stack
		.axis("horizontal")
		.align("start")
		.density("cozy")
		.children(
			h.stack
				.density("tight")
				.children(
					h.heading.size("large").children(options.title),
					h.text.role("label").tone("muted").children(options.subtitle),
				),
			h.spacer,
			...((options.actions ?? []) as Array<never>),
		)

/** Where an integration stands, as its card's status line says it. */
export type IntegrationStatus = "connected" | "disconnected" | "comingSoon"

const STATUS = {
	connected: { label: "Connected", tone: "success" },
	disconnected: { label: "Not connected", tone: "muted" },
	comingSoon: { label: "Coming soon", tone: "muted" },
} satisfies Record<IntegrationStatus, { readonly label: string; readonly tone: TextTone }>

/**
 * An integration's logo on its tile.
 * HAZEL-GAP(p5a-integration-logo): today's is a white 44pt `rounded-xl` tile with a hairline ring and a
 * 24pt glyph (a Brandfetch icon fills it); `iconTile` is the 40pt secondary tile with a 20pt picture.
 */
export const integrationLogo = <Msg>(h: H<Msg>, integration: Integration) =>
	h.iconTile.name("integration").image(integrationLogoSrc(integration))

/**
 * An integration's card: its logo, name and status, what it does; `onOpen` opens its page.
 * HAZEL-GAP(p5a-card-press): today the whole card is the button (a hover edge and wash, the chevron
 * shown on hover); `frame` has no `press`, so the chevron is the card's open button, always shown.
 * HAZEL-GAP(p5a-card-muted): a Coming soon card is on `bg-muted/30` today.
 * HAZEL-GAP(p5a-text-relaxed): its description is 14/22.75 today; `label` is 14/20.
 * HAZEL-GAP(p5a-heading-tracking): card titles draw at -0.154px tracking today.
 */
export const integrationCard = <Msg>(
	h: H<Msg>,
	integration: Integration,
	status: IntegrationStatus,
	onOpen: Msg,
) =>
	h.frame
		.key(integration.id)
		.surface("tile")
		.children(
			h.stack
				.axis("horizontal")
				.align("center")
				.density("cozy")
				.children(
					integrationLogo(h, integration),
					h.stack.density("tight").children(
						h.heading.level("3").children(integration.name),
						// HAZEL-GAP(p5a-status-line): today's dot takes the tone and the label stays muted.
						h.text.role("caption").dot().tone(STATUS[status].tone).children(STATUS[status].label),
					),
					h.spacer,
					status === "comingSoon"
						? null
						: h.button
								.label(`Open ${integration.name}`)
								.icon("chevron-right")
								.iconOnly()
								.variant("ghost")
								.size("small")
								.on("press", onOpen),
				),
			h.text.role("label").tone("muted").children(integration.description),
		)

/**
 * A bot's permissions: one chip per resource, `Messages · Read, Write`.
 * HAZEL-GAP(p5a-scope-chip): today's chip is `px-1.5 py-0.5` at regular weight with the dot at half
 * ink, and the bot's allowed integrations follow as 12pt logos; a small badge is `px-1`, medium.
 */
const scopeChips = <Msg>(h: H<Msg>, bot: Bot) =>
	bot.scopes.length === 0
		? null
		: h.stack
				.axis("horizontal")
				.density("snug")
				.wrap()
				.children(
					...Object.entries(groupScopesByResource(bot.scopes)).map(([resource, actions]) =>
						h.badge
							.key(resource)
							.size("small")
							.label(`${capitalize(resource)} · ${actions.map(capitalize).join(", ")}`),
					),
				)

const botAvatar = <Msg>(h: H<Msg>, bot: Bot, size: "medium" | "large") =>
	h.avatar
		.name(bot.name || "bot")
		.initials((bot.name || "B").slice(0, 1).toUpperCase())
		.src(bot.avatarUrl ?? undefined)
		.size(size)

/** The "Bot actions" menu of Your apps: each entry's id is what `select` reports. */
export const BOT_MENU: MenuGroups = [
	{
		entries: [
			{ id: "edit", label: "Edit", icon: "edit" },
			{ id: "regenerate", label: "Regenerate token", icon: "refresh" },
		],
	},
	{ entries: [{ id: "delete", label: "Delete", icon: "trash", destructive: true }] },
]

/** A bot card's actions: Your apps' menu, or Installed apps' uninstall (asked once, then confirmed). */
export type BotCardActions<Msg> =
	| Readonly<{ _tag: "Menu"; onSelect: (id: string) => Msg }>
	| Readonly<{
			_tag: "Uninstall"
			state: "Idle" | "Confirming" | "Uninstalling"
			onUninstall: Msg
			onConfirm: Msg
			onCancel: Msg
	  }>

/**
 * The uninstall band under the card.
 * HAZEL-GAP(p5a-card-band): today's band is `bg-muted/20` under a hairline; `frame` has no muted footer
 * band, so it is the padded row under a `divider`.
 */
const uninstallBand = <Msg>(
	h: H<Msg>,
	bot: Bot,
	actions: Extract<BotCardActions<Msg>, { readonly _tag: "Uninstall" }>,
) =>
	h.stack
		.axis("horizontal")
		.align("center")
		.density("compact")
		.inset("bar")
		.children(
			...(actions.state === "Confirming"
				? [
						h.text.role("caption").truncate().children(`Uninstall ${bot.name}?`),
						h.spacer,
						h.button
							.label("Cancel")
							.variant("outline")
							.size("small")
							.on("press", actions.onCancel),
						h.button
							.label("Uninstall")
							.variant("danger")
							.size("small")
							.on("press", actions.onConfirm),
					]
				: [
						h.spacer,
						h.button
							.label(actions.state === "Uninstalling" ? "Uninstalling..." : "Uninstall")
							.variant("outline")
							.size("small")
							.loading(actions.state === "Uninstalling")
							.disabled(actions.state === "Uninstalling")
							.on("press", actions.onUninstall),
					]),
		)

/** A bot in Your apps or Installed apps: its face, name, description and permissions. */
export const botCard = <Msg>(h: H<Msg>, bot: Bot, actions: BotCardActions<Msg>) =>
	h.frame
		.key(bot.id)
		.surface("flush")
		.children(
			h.stack.inset("page").children(
				h.stack
					.axis("horizontal")
					.align("start")
					.density("cozy")
					.children(
						botAvatar(h, bot, "medium"),
						h.stack.density("tight").children(
							h.stack
								.axis("horizontal")
								.align("center")
								.density("compact")
								.children(
									h.heading.level("3").children(bot.name),
									bot.isPublic ? h.badge.label("Public").size("small") : null,
								),
							// HAZEL-GAP(p5a-line-clamp): today's description is two lines at most, two lines tall; `truncate`
							// is one line and does not clip in a row (no `min-width: 0`), so it wraps in full.
							h.text
								.role("caption")
								.tone("muted")
								.children(bot.description || "No description"),
						),
						h.spacer,
						actions._tag === "Menu"
							? h.menu
									.label("Bot actions")
									.entries(BOT_MENU)
									.trigger(
										h.button
											.label("Bot actions")
											.icon("dots-vertical")
											.iconOnly()
											.variant("ghost")
											.size("small"),
									)
									.on("select", ({ id }) => actions.onSelect(id))
							: null,
					),
				scopeChips(h, bot),
			),
			// The band closes the card at the grid row's height (today's `mt-auto`).
			actions._tag === "Uninstall" ? h.spacer : null,
			actions._tag === "Uninstall" ? h.divider : null,
			actions._tag === "Uninstall" ? uninstallBand(h, bot, actions) : null,
		)

/** A public bot in the Marketplace: who made it, what it does, its installs and Install. */
export const marketplaceBotCard = <Msg>(
	h: H<Msg>,
	bot: PublicBot,
	options: Readonly<{ isInstalled: boolean; isInstalling: boolean; onInstall: Msg }>,
) =>
	h.frame
		.key(bot.id)
		.surface("flush")
		.children(
			h.stack.inset("page").children(
				h.stack
					.axis("horizontal")
					.align("start")
					.density("cozy")
					.children(
						botAvatar(h, bot, "large"),
						h.stack
							.density("tight")
							.children(
								h.heading.level("3").children(bot.name),
								h.text
									.role("caption")
									.tone("muted")
									.truncate()
									.children(`by ${bot.creatorName}`),
							),
					),
				h.text
					.role("label")
					.tone("muted")
					.children(bot.description || "No description provided"),
				scopeChips(h, bot),
			),
			h.spacer,
			h.divider,
			h.stack
				.axis("horizontal")
				.align("center")
				.inset("bar")
				.children(
					h.stack.axis("horizontal").align("center").density("snug").children(
						// HAZEL-GAP(p5a-muted-glyph): today's glyph is 14pt in muted ink.
						h.icon.name("download"),
						h.text
							.role("caption")
							.tone("muted")
							.numeric()
							.children(bot.installCount.toLocaleString()),
					),
					h.spacer,
					options.isInstalled
						? h.button
								.label("Installed")
								.icon("check")
								.variant("outline")
								.size("small")
								.disabled()
						: h.button
								.label(options.isInstalling ? "Installing..." : "Install")
								.size("small")
								.disabled(options.isInstalling)
								.on("press", options.onInstall),
				),
		)
