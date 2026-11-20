import type { Html, HtmlBuilder } from "foldkit/html"
import { IconEmojiAdd, IconMsgs, IconPin, IconPlus } from "../../icons"
import { button } from "../../ui/button"
import { emptyState } from "../../ui/empty-state"
import { loader } from "../../ui/loader"
import { progressBar, progressBarTrack, valueText } from "../../ui/progress-bar"
import * as Tooltip from "../../ui/tooltip"
import { group, kitSection, pair, specimen } from "./chrome"
import { Message, type Model, type ToastKind } from "./model"

type H = HtmlBuilder<Message>

const TOAST_BUTTONS = [
	{ kind: "success", label: "Success" },
	{ kind: "error", label: "Error" },
	{ kind: "warning", label: "Warning" },
	{ kind: "info", label: "With an action" },
	{ kind: "loading", label: "Loading" },
] as const satisfies ReadonlyArray<Readonly<{ kind: ToastKind; label: string }>>

const toasts = (h: H): Html =>
	specimen(
		h,
		{
			name: "Toast",
			file: "ui/toast.ts",
			note: "The result of something the person just did. It leaves on its own unless it carries an action.",
		},
		TOAST_BUTTONS.map((entry) =>
			h.keyed("span")(
				entry.kind,
				[h.Class("contents")],
				[
					button(
						h,
						{
							intent: "outline",
							size: "sm",
							onPress: Message.PressedShowToast({ kind: entry.kind }),
						},
						[entry.label],
					),
				],
			),
		),
	)

const meter = (h: H, label: string, value: number): Html =>
	progressBar(h, { ariaLabel: label, value }, [
		h.div(
			[
				h.Attribute("data-slot", "progress-bar-header"),
				h.Class("flex justify-between text-fg text-sm"),
			],
			[h.span([], [label]), h.span([h.Class("text-fg-2 tabular-nums")], [valueText({ value })])],
		),
		progressBarTrack(h, { value }),
	])

const progress = (h: H): Html =>
	specimen(
		h,
		{
			name: "Progress bar",
			file: "ui/progress-bar.ts",
			note: "How far along, when that is known. A sweep when it is not.",
			className: "flex-col items-stretch gap-5",
		},
		[
			meter(h, "Importing messages", 32),
			meter(h, "Storage used", 86),
			progressBar(h, { ariaLabel: "Connecting", isIndeterminate: true }, [
				h.div(
					[
						h.Attribute("data-slot", "progress-bar-header"),
						h.Class("flex justify-between text-fg text-sm"),
					],
					[h.span([], ["Connecting to Slack"])],
				),
				progressBarTrack(h, { isIndeterminate: true }),
			]),
		],
	)

const loaders = (h: H): Html =>
	specimen(
		h,
		{
			name: "Loader",
			file: "ui/loader.ts",
			note: "A wait with no measure. Spin inside a control, ring where it stands alone.",
			className: "gap-8",
		},
		[
			group(
				h,
				"Spin",
				[
					loader(h, { className: "size-3.5" }),
					loader(h, {}),
					loader(h, { className: "size-5" }),
					loader(h, { className: "size-6" }),
				],
				"gap-4 text-fg-3",
			),
			group(
				h,
				"Ring",
				[
					loader(h, { variant: "ring", className: "size-3.5" }),
					loader(h, { variant: "ring" }),
					loader(h, { variant: "ring", className: "size-5" }),
					loader(h, { variant: "ring", className: "size-6 text-primary" }),
				],
				"gap-4 text-fg-3",
			),
		],
	)

const tooltips = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Tooltip",
			file: "ui/tooltip.ts",
			note: "The name of an icon-only control, on hover or keyboard focus. Never the only place a fact lives.",
			className: "gap-4",
		},
		[
			h.submodel({
				slotId: model.tooltip.id,
				model: model.tooltip,
				view: Tooltip.view,
				viewInputs: {
					toTrigger: (attributes, overlay) =>
						h.span(
							[h.Class("inline-flex")],
							[
								button(
									h,
									{
										intent: "outline",
										size: "sq-sm",
										attributes: [...attributes, h.AriaLabel("Add reaction")],
									},
									[IconEmojiAdd(h)],
								),
								overlay,
							],
						),
					content: ["Add reaction"],
				},
				toParentMessage: (message: Tooltip.Message) => Message.GotTooltipMessage({ message }),
			}),
			h.submodel({
				slotId: model.tooltipInverse.id,
				model: model.tooltipInverse,
				view: Tooltip.view,
				viewInputs: {
					toTrigger: (attributes, overlay) =>
						h.span(
							[h.Class("inline-flex")],
							[
								button(
									h,
									{
										intent: "outline",
										size: "sq-sm",
										attributes: [...attributes, h.AriaLabel("Pin message")],
									},
									[IconPin(h)],
								),
								overlay,
							],
						),
					content: ["Pin message"],
					inverse: true,
					placement: "bottom",
				},
				toParentMessage: (message: Tooltip.Message) => Message.GotTooltipInverseMessage({ message }),
			}),
			h.span([h.Class("text-fg-2 text-sm")], ["Hover or focus a button."]),
		],
	)

const empty = (h: H): Html =>
	specimen(
		h,
		{
			name: "Empty state",
			file: "ui/empty-state.ts",
			note: "Nothing here yet: say what will appear and offer the one action that makes it.",
			className: "justify-center",
		},
		[
			emptyState(h, {
				title: "No messages yet",
				description: "Say hello, or share what this channel is for.",
				icon: (className) => IconMsgs(h, { className }),
				action: button(
					h,
					{
						intent: "primary",
						size: "sm",
						onPress: Message.PressedAction({ label: "Start a conversation" }),
					},
					[IconPlus(h), "Start a conversation"],
				),
				className: "py-6",
			}),
		],
	)

export const feedback = (h: H, model: Model): Html =>
	kitSection(h, "feedback", [
		pair(h, [toasts(h), tooltips(h, model)]),
		pair(h, [progress(h), h.div([h.Class("flex flex-col gap-8")], [loaders(h), empty(h)])]),
	])
