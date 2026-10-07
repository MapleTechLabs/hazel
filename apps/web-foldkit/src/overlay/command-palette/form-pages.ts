import type { Html, HtmlBuilder } from "foldkit/html"
import { IconHashtag, IconLock } from "../../icons"
import { button } from "../../ui/button"
import {
	commandMenuFormBody,
	commandMenuFormContainer,
	commandMenuFormField,
	commandMenuFormFooter,
	commandMenuFormHeader,
	commandMenuInput,
	commandMenuToggle,
} from "../../ui/command-menu-form"
import { Message } from "./message"
import type { ChannelType, Model, PageState } from "./model"
import { CREATE_CHANNEL_INPUT_ID, JOIN_CHANNEL_INPUT_ID } from "./update"

/** `CreateChannelView` and `JoinChannelView`, the palette's form pages. */

type CreateChannelPage = Extract<PageState, { _tag: "CreateChannel" }>
type JoinChannelPage = Extract<PageState, { _tag: "JoinChannel" }>

/** Legacy `channelIcon` with a class (`ChannelIcon`). */
const channelIcon = (h: HtmlBuilder<Message>, icon: string | null, className: string): Html =>
	icon ? h.span([h.Attribute("data-slot", "icon"), h.Class(className)], [icon]) : IconHashtag(h, { className })

const header = (h: HtmlBuilder<Message>, title: string, subtitle: string) =>
	commandMenuFormHeader(h, {
		title,
		subtitle,
		backAttributes: [h.OnClick(Message.ClickedBack())],
		closeAttributes: [h.OnClick(Message.ClickedEscButton())],
	})

export const createChannelPage = (h: HtmlBuilder<Message>, page: CreateChannelPage): Html =>
	commandMenuFormContainer(h, [
		header(h, "Create Channel", "Create a new channel for your team"),
		h.form(
			[h.OnSubmit(Message.SubmittedCreateChannel())],
			[
				commandMenuFormBody(
					h,
					[
						commandMenuFormField(h, { label: "Channel name", error: page.error ?? undefined }, [
							commandMenuInput(h, {
								attributes: [
									h.Id(CREATE_CHANNEL_INPUT_ID),
									h.Attribute("placeholder", "e.g. general, design, marketing"),
									h.Attribute("style", ""),
									h.Value(page.name),
									h.OnInput((value) => Message.ChangedChannelName({ value })),
								],
							}),
						]),
						commandMenuFormField(h, { label: "Channel type" }, [
							commandMenuToggle(h, {
								name: "command-palette-channel-type",
								value: page.channelType,
								options: [
									{ value: "public", label: "Public", icon: IconHashtag(h, { className: "size-4" }) },
									{ value: "private", label: "Private", icon: IconLock(h, { className: "size-4" }) },
								],
								onChange: (value) =>
									Message.ChangedChannelType({ value: value === "private" ? "private" : ("public" satisfies ChannelType) }),
							}),
						]),
					],
					"space-y-4",
				),
				commandMenuFormFooter(h, [
					h.span([], [h.kbd([], ["Tab"]), " to switch fields"]),
					button(
						h,
						{
							size: "xs",
							intent: "primary",
							isDisabled: page.name.trim() === "" || page.isSubmitting,
							attributes: [h.Type("submit")],
						},
						page.isSubmitting ? ["Creating..."] : ["Create", h.kbd([], ["↵"])],
					),
				]),
			],
		),
	])

export const joinChannelPage = (h: HtmlBuilder<Message>, model: Model, page: JoinChannelPage): Html => {
	const unjoined = model.unjoinedChannels ?? []
	const query = page.searchQuery.trim().toLowerCase()
	const filtered = query === "" ? unjoined : unjoined.filter((channel) => channel.name.toLowerCase().includes(query))
	return commandMenuFormContainer(h, [
		header(h, "Join Channel", "Browse and join available channels"),
		commandMenuFormBody(
			h,
			[
				h.div(
					[h.Class("border-b px-3 py-2 sm:px-2.5")],
					[
						commandMenuInput(h, {
							attributes: [
								h.Id(JOIN_CHANNEL_INPUT_ID),
								h.Attribute("placeholder", "Search channels..."),
								h.Attribute("style", ""),
								h.Value(page.searchQuery),
								h.OnInput((value) => Message.ChangedJoinSearch({ value })),
							],
						}),
					],
				),
				h.div(
					[h.Class("max-h-64 overflow-y-auto p-2")],
					[
						unjoined.length === 0
							? h.div(
									[h.Class("flex flex-col items-center justify-center py-8 text-center")],
									[
										IconHashtag(h, { className: "mb-3 size-8 text-muted-fg" }),
										h.p([h.Class("text-muted-fg text-sm")], ["You've joined all available channels"]),
									],
								)
							: filtered.length === 0
								? h.div([h.Class("py-4 text-center text-muted-fg text-sm")], ["No channels match your search"])
								: h.div(
										[h.Class("space-y-1")],
										filtered.map((channel) =>
											h.keyed("button")(
												channel.id,
												[
													h.Type("button"),
													h.Class(
														"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
													),
													h.OnClick(Message.ClickedJoinChannel({ channelId: channel.id })),
												],
												[
													channelIcon(h, channel.icon, "size-4 text-muted-fg"),
													h.span([h.Class("flex-1 truncate")], [channel.name]),
													h.span([h.Class("rounded bg-primary/10 px-2 py-0.5 text-primary text-xs")], ["Join"]),
												],
											),
										),
									),
					],
				),
			],
			"p-0",
		),
	])
}
