import type { Html, HtmlBuilder } from "foldkit/html"
import type { PresenceStatus } from "~/utils/presence"
import { avatar } from "../../ui/avatar"
import { badge } from "../../ui/badge"
import { button } from "../../ui/button"
import { card, cardBody, cardDescription, cardHeader, cardTitle } from "../../ui/card"
import { presenceDot } from "../../ui/presence-dot"
import { sectionLabelRoot } from "../../ui/section-label"
import { separator } from "../../ui/separator"
import { resizeEdge, splitPanelClassName } from "../../ui/split-panel"
import { group, kitSection, pair, specimen } from "./chrome"
import { Message, type Model } from "./model"

type H = HtmlBuilder<Message>

const AVATAR_SIZES = ["xxs", "xs", "sm", "md", "lg", "xl"] as const

const PEOPLE = [
	"Ada Lovelace",
	"Grace Hopper",
	"Linus Torvalds",
	"Margaret Hamilton",
	"Ken Thompson",
] as const

const PRESENCE: ReadonlyArray<Readonly<{ status: PresenceStatus; name: string }>> = [
	{ status: "online", name: "Ada Lovelace" },
	{ status: "away", name: "Grace Hopper" },
	{ status: "dnd", name: "Linus Torvalds" },
	{ status: "offline", name: "Margaret Hamilton" },
]

const avatars = (h: H): Html =>
	specimen(
		h,
		{
			name: "Avatar",
			file: "ui/avatar.ts · ui/presence-dot.ts",
			note: "A picture, or a dithered initial in a hue picked from the name. Presence sits on the corner.",
			className: "flex-col items-start gap-6",
		},
		[
			group(
				h,
				"Sizes",
				AVATAR_SIZES.map((size) =>
					h.keyed("span")(size, [h.Class("contents")], [avatar(h, { size, seed: "Ada Lovelace" })]),
				),
				"items-end gap-3",
			),
			group(
				h,
				"People",
				[
					...PEOPLE.map((name) =>
						h.keyed("span")(name, [h.Class("contents")], [avatar(h, { size: "md", seed: name })]),
					),
					avatar(h, { size: "md", seed: "Hazel", isSquare: false }),
					avatar(h, { size: "md", fallbackIcon: true }),
				],
				"gap-3",
			),
			group(
				h,
				"Presence",
				PRESENCE.map((entry) =>
					h.keyed("span")(
						entry.status,
						[h.Class("contents")],
						[
							avatar(h, {
								size: "md",
								seed: entry.name,
								badge: presenceDot(h, entry.status, "sm"),
							}),
						],
					),
				),
				"gap-4",
			),
		],
	)

const cards = (h: H): Html =>
	specimen(
		h,
		{
			name: "Card",
			file: "ui/card.ts",
			note: "One group of settings with its own title. The danger card holds what cannot be undone.",
			className: "flex-col items-stretch gap-4 bg-muted/40",
		},
		[
			card(h, {}, [
				cardHeader(h, [
					cardTitle(h, {}, ["Workspace"]),
					cardDescription(h, {}, ["The name and address people sign in to."]),
				]),
				cardBody(h, [
					h.div(
						[h.Class("flex items-center justify-between gap-4")],
						[
							h.div(
								[h.Class("flex flex-col")],
								[
									h.span([h.Class("font-medium text-fg text-sm")], ["Acme Inc."]),
									h.span([h.Class("text-fg-2 text-sm")], ["acme.hazel.sh"]),
								],
							),
							badge(h, { intent: "success" }, ["Pro"]),
						],
					),
				]),
			]),
			card(h, { variant: "danger" }, [
				cardBody(h, [
					h.div(
						[h.Class("flex items-center justify-between gap-4")],
						[
							h.div(
								[h.Class("flex flex-col")],
								[
									h.span([h.Class("font-medium text-fg text-sm")], ["Delete workspace"]),
									h.span(
										[h.Class("text-fg-2 text-sm")],
										["Removes every channel and message for everyone."],
									),
								],
							),
							button(
								h,
								{
									intent: "danger",
									size: "sm",
									onPress: Message.PressedAction({ label: "Delete workspace" }),
								},
								["Delete"],
							),
						],
					),
				]),
			]),
		],
	)

const labels = (h: H): Html =>
	specimen(
		h,
		{
			name: "Section label",
			file: "ui/section-label.ts",
			note: "A setting's name and what it does, beside its control.",
			className: "flex-col items-stretch gap-5",
		},
		[
			sectionLabelRoot(h, {
				title: "Message density",
				description: "How much room each message takes.",
			}),
			sectionLabelRoot(h, {
				title: "Workspace name",
				description: "Shown in the sidebar and in invitations.",
				isRequired: true,
				size: "md",
			}),
		],
	)

const separators = (h: H): Html =>
	specimen(
		h,
		{
			name: "Separator",
			file: "ui/separator.ts",
			note: "A hairline between groups. Space separates first: reach for a line only when it does not.",
			className: "flex-col items-stretch gap-4",
		},
		[
			h.div(
				[h.Class("flex flex-col gap-3 text-fg-3 text-sm")],
				[h.span([], ["Profile"]), separator(h), h.span([], ["Notifications"])],
			),
			h.div(
				[h.Class("flex h-5 items-center gap-3 text-fg-3 text-sm")],
				[
					h.span([], ["42 members"]),
					separator(h, { orientation: "vertical" }),
					h.span([], ["3 guests"]),
					separator(h, { orientation: "vertical" }),
					h.span([], ["Public"]),
				],
			),
		],
	)

const splitPanels = (h: H): Html =>
	specimen(
		h,
		{
			name: "Split panel",
			file: "ui/split-panel.ts",
			note: "A side panel beside the page (a thread, the AI assistant), resized by dragging its edge or with the arrow keys once the edge is focused.",
			className: "items-stretch",
		},
		[
			h.div(
				[h.Class("flex h-40 w-full overflow-hidden rounded-lg border border-border")],
				[
					h.div([h.Class("flex-1 p-3 text-fg-3 text-sm")], ["Page"]),
					h.div(
						[h.Class(splitPanelClassName("right", "w-48")), h.Style({ height: "100%" })],
						[
							resizeEdge(h, {
								label: "Resize panel",
								position: "right",
								width: 192,
								minWidth: 160,
								isDragging: false,
								onPress: () => Message.PressedAction({ label: "Resize panel" }),
								onNudge: () => Message.PressedAction({ label: "Resize panel" }),
							}),
							h.div([h.Class("p-3 text-fg-3 text-sm")], ["Panel"]),
						],
					),
				],
			),
		],
	)

export const display = (h: H, _model: Model): Html =>
	kitSection(h, "display", [
		pair(h, [avatars(h), cards(h)]),
		pair(h, [labels(h), separators(h)]),
		splitPanels(h),
	])
