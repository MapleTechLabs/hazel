import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { cx } from "~/utils/cx"
import { avatar } from "../ui/avatar"
import { type BotCommand, type CommandInput, Message, type Model } from "./composer"
import { commandFieldId } from "./editor-commands"
import { listBox } from "./autocomplete-view"
import {
	clampedActiveIndex,
	type CommandOption,
	commandOptions,
	type EmojiOption,
	emojiOptions,
} from "./options"

/** `CommandTrigger` / `BotCommandItem`, `EmojiTrigger` / `EmojiItem` and `CommandInputPanel`. */

const botAvatar = <M>(h: HtmlBuilder<M>, bot: BotCommand["bot"], className: string): Html =>
	avatar(h, { size: "xs", src: bot.avatarUrl, seed: bot.name, alt: bot.name, className })

const botCommandItem = <M>(h: HtmlBuilder<M>, option: CommandOption, isFocused: boolean): Html => {
	const { command } = option
	return h.div(
		[h.Class("flex items-start gap-2.5")],
		[
			botAvatar(h, command.bot, "mt-0.5 size-5"),
			h.div(
				[h.Class("min-w-0 flex-1")],
				[
					h.div(
						[h.Class("flex flex-wrap items-center gap-1.5")],
						[
							h.span(
								[h.Class(cx("font-medium", isFocused ? "text-primary" : "text-fg"))],
								[`/${command.name}`],
							),
							...command.arguments.map((arg) =>
								h.span(
									[
										h.Class(
											cx(
												"rounded px-1.5 py-0.5 text-xs",
												arg.required
													? "bg-warning/20 text-warning"
													: "bg-muted text-muted-fg",
											),
										),
									],
									[arg.required ? `<${arg.name}>` : `[${arg.name}]`],
								),
							),
						],
					),
					h.div([h.Class("mt-0.5 truncate text-muted-fg text-xs")], [command.description]),
				],
			),
		],
	)
}

export const commandTriggerContent = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	toMessage: (message: Message) => M,
): Html => {
	const activeIndex = clampedActiveIndex(model)
	return listBox(
		h,
		model.editorId,
		commandOptions(model).map((option, index) => ({
			id: option.id,
			content: botCommandItem(h, option, index === activeIndex),
		})),
		activeIndex,
		"No bot commands available",
		toMessage,
	)
}

const emojiItem = <M>(h: HtmlBuilder<M>, option: EmojiOption): Html =>
	h.div(
		[h.Class("flex items-center gap-2")],
		[
			option.imageUrl
				? h.img([
						h.Attribute("src", option.imageUrl),
						h.Attribute("alt", option.name),
						h.Class("size-5 object-contain"),
					])
				: h.span([h.Class("text-xl")], [option.emoji]),
			h.span([h.Class("text-muted-fg")], [`:${option.name}:`]),
		],
	)

export const emojiTriggerContent = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	toMessage: (message: Message) => M,
): Html =>
	listBox(
		h,
		model.editorId,
		emojiOptions(model).map((option) => ({ id: option.id, content: emojiItem(h, option) })),
		clampedActiveIndex(model),
		(model.autocomplete?.search.length ?? 0) < 2 ? "Type at least 2 characters" : "No emoji found",
		toMessage,
	)

const commandKeys = ["Tab", "Enter", "Escape"]

/** `CommandInputPanel`: replaces the editor while a slash command collects arguments. */
export const commandInputPanel = <M>(
	h: HtmlBuilder<M>,
	editorId: string,
	input: CommandInput,
	toMessage: (message: Message) => M,
): Html => {
	const { command } = input
	const isExecuting = input.submission === "Executing"
	return h.div(
		[h.Class("mb-2 rounded-lg border border-border bg-surface-2 p-4")],
		[
			h.div(
				[h.Class("mb-3 flex items-center gap-2")],
				[
					botAvatar(h, command.bot, "size-5"),
					h.span([h.Class("font-medium text-fg")], [`/${command.name}`]),
					h.span([h.Class("text-muted-fg text-sm")], [command.description]),
				],
			),
			command.arguments.length > 0
				? h.div(
						[h.Class("flex flex-wrap gap-4")],
						command.arguments.map((arg, index) =>
							h.keyed("label")(
								arg.name,
								[h.Class("min-w-48 flex-1")],
								[
									h.span(
										[h.Class("mb-1 block text-fg text-sm")],
										[
											arg.name,
											arg.required
												? h.span(
														[h.Class("ml-1 text-warning"), h.AriaHidden(true)],
														["*"],
													)
												: h.empty,
										],
									),
									h.input([
										h.Id(commandFieldId(editorId, index)),
										h.Attribute("type", arg.type === "number" ? "number" : "text"),
										h.Value(input.values[arg.name] ?? ""),
										h.Attribute("placeholder", arg.placeholder ?? arg.description ?? ""),
										h.AriaRequired(arg.required),
										h.OnInput((value) =>
											toMessage(
												Message.UpdatedCommandValue({ argName: arg.name, value }),
											),
										),
										h.OnKeyDownPreventDefault((key, modifiers) =>
											commandKeys.includes(key)
												? Option.some(
														toMessage(
															Message.PressedCommandFieldKey({
																index,
																key,
																shiftKey: modifiers.shiftKey,
															}),
														),
													)
												: Option.none(),
										),
										h.Class(
											"w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none",
										),
									]),
								],
							),
						),
					)
				: h.empty,
			h.div(
				[h.Class("mt-4 flex justify-end gap-2")],
				[
					h.button(
						[
							h.Attribute("type", "button"),
							h.OnClick(toMessage(Message.ClickedCancelCommand())),
							h.Class(
								"rounded-md px-3 py-1.5 text-muted-fg text-sm hover:bg-muted hover:text-fg",
							),
						],
						["Cancel"],
					),
					h.button(
						[
							h.Attribute("type", "button"),
							h.OnClick(toMessage(Message.ClickedExecuteCommand())),
							...(isExecuting ? [h.Disabled(true), h.AriaBusy(true)] : []),
							h.Class(
								"rounded-md bg-primary px-3 py-1.5 text-primary-fg text-sm hover:bg-primary/90 disabled:opacity-50",
							),
						],
						[isExecuting ? "Executing…" : "Execute"],
					),
				],
			),
		],
	)
}
