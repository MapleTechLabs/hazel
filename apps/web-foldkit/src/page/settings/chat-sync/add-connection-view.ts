import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { button } from "../../../ui/button"
import { dialogBody, dialogClose, dialogFooter, dialogHeader, dialogTitle } from "../../../ui/dialog"
import { description, label } from "../../../ui/field"
import * as Modal from "../../../ui/modal"
import { GUILD_SEARCH_ID } from "./add-connection"
import { discordLogo } from "./brand-icons"
import type { DiscordGuild } from "./discord"
import { filterByName, scrollList, searchInput, selectedName, selectedRow, spinnerLine } from "./modal-parts"
import { Message, type Model } from "./model"
import { CONNECT_TARGET, GUILD_SEARCH_TARGET, interaction } from "./update"

/** Port of `components/chat-sync/add-connection-modal.tsx`. */

const toAddModalMessage = (message: Modal.Message) => Message.GotAddModalMessage({ message })
const toGuildSearchMessage = (value: string) => Message.ChangedGuildSearch({ value })

const guildRow = (h: HtmlBuilder<Message>, guild: DiscordGuild): Html =>
	h.keyed("button")(
		guild.id,
		[
			h.Type("button"),
			h.OnClick(Message.ClickedGuild({ guild })),
			h.Class(
				"flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/50",
			),
		],
		[
			h.span([h.Class("truncate text-fg")], [guild.name]),
			...(guild.owner
				? [
						h.span(
							[h.Class("rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-fg")],
							["Owner"],
						),
					]
				: []),
		],
	)

const guildPicker = (h: HtmlBuilder<Message>, model: Model, guilds: ReadonlyArray<DiscordGuild>): Html =>
	h.div(
		[h.Class("flex flex-col gap-3")],
		[
			label(h, {}, ["Discord Server"]),
			...(model.selectedGuild === null
				? [
						searchInput(h, {
							id: GUILD_SEARCH_ID,
							placeholder: "Search servers...",
							value: model.guildSearch,
							isFocused: model.isGuildSearchFocused,
							onInput: toGuildSearchMessage,
							onFocus: Message.FocusedGuildSearch(),
							onBlur: Message.BlurredGuildSearch(),
							hover: { wiring: interaction.wiring(model), target: GUILD_SEARCH_TARGET },
						}),
						scrollList(
							h,
							"max-h-56",
							"No Discord servers found",
							filterByName(guilds, model.guildSearch).map((guild) => guildRow(h, guild)),
						),
					]
				: [
						selectedRow(
							h,
							[selectedName(h, model.selectedGuild.name)],
							Message.ClickedChangeGuild(),
						),
					]),
			description(h, {}, ["Select the Discord server you want to sync with Hazel."]),
		],
	)

const connectFirst = (h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("rounded-lg border border-border bg-bg-muted/20 p-4")],
		[
			h.p([h.Class("font-medium text-fg text-sm")], ["Connect Discord first"]),
			h.p(
				[h.Class("mt-1 text-muted-fg text-sm")],
				["Authorize Discord in Integrations so we can load your guilds."],
			),
			button(
				h,
				{
					intent: "secondary",
					size: "sm",
					className: "mt-3",
					onPress: Message.ClickedOpenDiscordIntegration(),
				},
				["Open Discord Integration"],
			),
		],
	)

const body = (h: HtmlBuilder<Message>, model: Model): Html => {
	const guilds = model.discordGuilds
	if (guilds._tag === "Loading")
		return h.div(
			[h.Class("flex items-center justify-center py-8")],
			[spinnerLine(h, "Loading Discord guilds...")],
		)
	return guilds._tag === "Failed" ? connectFirst(h) : guildPicker(h, model, guilds.items)
}

const content = (
	h: HtmlBuilder<Message>,
	model: Model,
	closeAttributes: ReadonlyArray<ChildAttribute>,
): ReadonlyArray<Html> => [
	dialogHeader(h, {}, [
		h.div(
			[h.Class("flex items-center gap-3")],
			[
				h.div(
					[h.Class("flex size-10 items-center justify-center rounded-xl bg-[#5865F2]/[0.06]")],
					[discordLogo(h, "size-6")],
				),
				dialogTitle(h, { id: Modal.titleId(model.addModal.id) }, "Connect Discord Server"),
			],
		),
	]),
	dialogBody(h, [body(h, model)], "flex flex-col gap-5"),
	dialogFooter(h, [
		dialogClose(h, closeAttributes, ["Cancel"], "secondary"),
		button(
			h,
			{
				intent: "primary",
				onPress: Message.ClickedConnect(),
				isDisabled:
					model.selectedGuild === null || model.isCreating || model.discordGuilds._tag !== "Loaded",
				isPending: model.isCreating,
				interaction: { wiring: interaction.wiring(model), target: CONNECT_TARGET },
			},
			[model.isCreating ? "Connecting..." : "Connect"],
		),
	]),
]

/** `<Modal><ModalContent isOpen onOpenChange size="md">`, rendered while open. */
export const addConnectionModal = (h: HtmlBuilder<Message>, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.addModal,
		toParentMessage: toAddModalMessage,
		toContent: (closeAttributes) => content(h, model, closeAttributes),
		size: "md",
	})
