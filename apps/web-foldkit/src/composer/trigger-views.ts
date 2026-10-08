import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { cx } from "~/utils/cx"
import { type BotCommand, type CommandInput, Message, type Model } from "./composer"
import { commandFieldId } from "./editor-commands"
import { listBox } from "./autocomplete-view"
import { clampedActiveIndex, type CommandOption, commandOptions, type EmojiOption, emojiOptions } from "./options"

/** `CommandTrigger` / `BotCommandItem`, `EmojiTrigger` / `EmojiItem` and `CommandInputPanel`. */

const botAvatar = <M>(h: HtmlBuilder<M>, bot: BotCommand["bot"], className: string, fallback: string): Html =>
	bot.avatarUrl
		? h.img([h.Attribute("src", bot.avatarUrl), h.Attribute("alt", bot.name), h.Class(className)])
		: h.div([h.Class(fallback)], [bot.name[0]?.toUpperCase() ?? ""])

const botCommandItem = <M>(h: HtmlBuilder<M>, option: CommandOption, isFocused: boolean): Html => {
	const { command } = option
	return h.div(
		[h.Class("flex items-start gap-2.5")],
		[
			botAvatar(
				h,
				command.bot,
				"mt-0.5 size-5 shrink-0 rounded-md",
				"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/20 font-medium text-primary text-xs",
			),
			h.div(
				[h.Class("min-w-0 flex-1")],
				[
					h.div(
						[h.Class("flex flex-wrap items-center gap-1.5")],
						[
							h.span([h.Class(cx("font-medium", isFocused ? "text-primary" : "text-fg"))], [`/${command.name}`]),
							...command.arguments.map((arg) =>
								h.span(
									[
										h.Class(
											cx(
												"rounded px-1.5 py-0.5 text-xs",
												arg.required ? "bg-warning/20 text-warning" : "bg-muted text-muted-fg",
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

export const commandTriggerContent = <M>(h: HtmlBuilder<M>, model: Model, toMessage: (message: Message) => M): Html => {
	const activeIndex = clampedActiveIndex(model)
	return listBox(
		h,
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
				? h.img([h.Attribute("src", option.imageUrl), h.Attribute("alt", option.name), h.Class("size-5 object-contain")])
				: h.span([h.Class("text-xl")], [option.emoji]),
			h.span([h.Class("text-muted-fg")], [`:${option.name}:`]),
		],
	)

export const emojiTriggerContent = <M>(h: HtmlBuilder<M>, model: Model, toMessage: (message: Message) => M): Html =>
	listBox(
		h,
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
	return h.div(
		[h.Class("mb-2 rounded-lg border border-border bg-surface-2 p-4")],
		[
			h.div(
				[h.Class("mb-3 flex items-center gap-2")],
				[
					botAvatar(
						h,
						command.bot,
						"size-5 rounded-md",
						"flex size-5 items-center justify-center rounded-md bg-primary/20 font-medium text-primary text-xs",
					),
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
										[arg.name, arg.required ? h.span([h.Class("ml-1 text-warning")], ["*"]) : h.empty],
									),
									h.input([
										h.Id(commandFieldId(editorId, index)),
										h.Attribute("type", arg.type === "number" ? "number" : "text"),
										h.Value(input.values[arg.name] ?? ""),
										h.Attribute("placeholder", arg.placeholder ?? arg.description ?? ""),
										h.OnInput((value) => toMessage(Message.UpdatedCommandValue({ argName: arg.name, value }))),
										h.OnFocus(toMessage(Message.FocusedCommandField({ index }))),
										h.OnKeyDownPreventDefault((key, modifiers) =>
											commandKeys.includes(key)
												? Option.some(
														toMessage(Message.PressedCommandFieldKey({ index, key, shiftKey: modifiers.shiftKey })),
													)
												: Option.none(),
										),
										h.Class(
											cx(
												"w-full rounded-md border bg-surface px-3 py-2 text-sm",
												"focus:border-primary focus:outline-none",
												input.focusedFieldIndex === index ? "border-primary" : "border-border",
											),
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
							h.Class("rounded-md px-3 py-1.5 text-muted-fg text-sm hover:bg-muted hover:text-fg"),
						],
						["Cancel"],
					),
					h.button(
						[
							h.Attribute("type", "button"),
							h.OnClick(toMessage(Message.ClickedExecuteCommand())),
							h.Class("rounded-md bg-primary px-3 py-1.5 text-primary-fg text-sm hover:bg-primary/90"),
						],
						["Execute"],
					),
				],
			),
		],
	)
}
