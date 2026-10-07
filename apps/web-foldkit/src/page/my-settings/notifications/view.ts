import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { ariaRadioGroup } from "../../../ui/aria-radio"
import type * as Interaction from "../../../ui/aria/interaction"
import { button } from "../../../ui/button"
import { dateField } from "../../../ui/date-field"
import { slider } from "../../../ui/slider"
import { switchControl } from "../../../ui/switch"
import type { PageViewInputs } from "../../contract"
import { divider, pageHeader, settingsRow } from "../shared"
import { Message } from "./message"
import { type Model, settingsOf, type SoundFile } from "./model"
import { interaction, toQuietHoursMessage, toVolumeMessage } from "./update"

/** Port of `routes/_app/$orgSlug/my-settings/notifications.tsx`. */

const soundOptions: ReadonlyArray<{ value: SoundFile; label: string; description: string }> = [
	{ value: "notification01", label: "Sound 1", description: "Classic notification" },
	{ value: "notification03", label: "Sound 2", description: "Modern alert" },
]

const isSoundFile = (value: string): value is SoundFile => value === "notification01" || value === "notification03"

const soundSettings = (h: HtmlBuilder<Message>, model: Model, wiring: Interaction.Wiring<Message>): Html => {
	const enabled = model.sound.enabled
	return h.div(
		[h.Class("flex flex-col gap-6")],
		[
			switchControl(
				h,
				{
					id: "notification-sounds",
					isSelected: enabled,
					onChange: (isSelected) => Message.ToggledSounds({ isSelected }),
					interaction: wiring,
				},
				"Enable notification sounds",
			),
			h.div(
				[h.Class("flex flex-col gap-3")],
				[
					h.div([h.Class("font-medium text-sm")], ["Notification sound"]),
					ariaRadioGroup(
						h,
						{
							id: "notification-sound",
							value: model.sound.soundFile,
							onChange: (value) =>
								Message.SelectedSound({ soundFile: isSoundFile(value) ? value : "notification01" }),
							isDisabled: !enabled,
							className: "grid grid-cols-1 gap-3 sm:grid-cols-2",
							interaction: wiring,
						},
						(radio) =>
							soundOptions.map((option) =>
								radio(option.value, { className: "cursor-pointer" }, ({ isSelected, isFocusVisible }) => [
									h.div(
										[
											h.Class(
												twMerge(
													"relative flex items-center gap-3 rounded-lg border-2 border-border bg-secondary p-4 transition-all",
													isSelected && "border-ring bg-secondary/50",
													isFocusVisible && "ring-2 ring-ring ring-offset-2",
													!enabled && "cursor-not-allowed opacity-50",
												),
											),
										],
										[
											h.div(
												[
													h.Class(
														twMerge(
															"relative flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
															isSelected ? "border-primary bg-primary" : "border-input bg-bg",
														),
													),
												],
												isSelected ? [h.div([h.Class("size-2 rounded-full bg-primary-fg")], [])] : [],
											),
											h.div(
												[h.Class("flex flex-1 flex-col")],
												[
													h.span([h.Class("font-medium text-sm")], [option.label]),
													h.span([h.Class("text-muted-fg text-xs")], [option.description]),
												],
											),
										],
									),
								]),
							),
					),
				],
			),
			h.div(
				[h.Class("flex flex-col gap-2")],
				[
					slider(h, { model: model.volume, toParentMessage: toVolumeMessage, interaction: wiring }, (parts) => [
						h.div(
							[h.Class("flex items-center justify-between")],
							[
								h.div([h.Class("font-medium text-sm")], ["Volume"]),
								parts.output({
									className: "text-muted-fg text-sm",
									format: (values) => `${Math.round((values[0] ?? 0) * 100)}%`,
								}),
							],
						),
						parts.track(),
					]),
				],
			),
			h.div(
				[h.Class("flex items-center gap-3")],
				[
					button(
						h,
						{
							isDisabled: !enabled,
							onPress: Message.ClickedTestSound(),
							interaction: { wiring, target: "test-sound" },
						},
						["Test sound"],
					),
					button(
						h,
						{
							intent: "outline",
							onPress: Message.ClickedTestNotification(),
							interaction: { wiring, target: "test-notification" },
						},
						["Test notification"],
					),
					...(model.notificationStatus === "sent"
						? [h.span([h.Class("text-sm text-success")], ["Notification sent!"])]
						: []),
					...(model.notificationStatus === "unavailable"
						? [
								h.span(
									[h.Class("text-muted-fg text-sm")],
									["Native notifications unavailable (desktop app only)"],
								),
							]
						: []),
				],
			),
		],
	)
}

const doNotDisturb = (h: HtmlBuilder<Message>, model: Model, wiring: Interaction.Wiring<Message>): Html => {
	const settings = settingsOf(model)
	const timeField = (field: "start" | "end", label: string) =>
		dateField(
			h,
			{
				model: field === "start" ? model.quietHoursStart : model.quietHoursEnd,
				toParentMessage: toQuietHoursMessage(field),
				className: "flex-1",
				interaction: wiring,
			},
			(parts) => [parts.label([label]), parts.dateInput()],
		)
	return h.div(
		[h.Class("flex flex-col gap-6")],
		[
			switchControl(
				h,
				{
					id: "do-not-disturb",
					isSelected: settings?.doNotDisturb ?? false,
					onChange: (isSelected) => Message.ToggledDoNotDisturb({ isSelected }),
					interaction: wiring,
				},
				"Enable do not disturb",
			),
			h.div(
				[h.Class("flex flex-col gap-3")],
				[
					h.div([h.Class("font-medium text-sm")], ["Quiet hours"]),
					h.p([h.Class("text-muted-fg text-sm")], ["No notifications will be sent during these hours"]),
					h.div(
						[h.Class("flex flex-col gap-4 sm:flex-row sm:items-center")],
						[...timeField("start", "Start time"), ...timeField("end", "End time")],
					),
				],
			),
			h.div(
				[h.Class("flex flex-col gap-2")],
				[
					switchControl(
						h,
						{
							id: "show-quiet-hours",
							isSelected: settings?.showQuietHoursInStatus ?? true,
							onChange: (isSelected) => Message.ToggledShowQuietHours({ isSelected }),
							interaction: wiring,
						},
						"Show quiet hours in status",
					),
					h.p(
						[h.Class("text-muted-fg text-sm")],
						["Display a moon indicator to others when you're in quiet hours"],
					),
				],
			),
		],
	)
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) => {
	const wiring = interaction.wiring(model)
	return h.form(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			pageHeader(h, "Notifications", "Manage how and when you receive notifications."),
			h.div(
				[h.Class("flex flex-col gap-5")],
				[
					settingsRow(
						h,
						{ title: "Sound settings", description: "Notification sounds" },
						soundSettings(h, model, wiring),
					),
					divider(h),
					settingsRow(
						h,
						{ title: "Do not disturb", description: "Quiet hours and DND mode" },
						doNotDisturb(h, model, wiring),
					),
				],
			),
		],
	)
})
