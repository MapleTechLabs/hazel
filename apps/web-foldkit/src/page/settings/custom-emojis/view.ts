import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { cx } from "~/utils/cx"
import { IconEmoji1, IconEmojiAdd, IconTrash } from "../../../icons"
import { visuallyHiddenStyle } from "../../../ui/checkbox"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { card, cardHeader } from "../../../ui/card"
import { emptyState } from "../../../ui/empty-state"
import { inputGroup } from "../../../ui/input"
import { textField } from "../../../ui/text-field"
import type { PageViewInputs, Shared } from "../../contract"
import { formatDistanceToNow } from "../format-distance"
import { ALLOWED_EMOJI_TYPES } from "../upload"
import { deleteEmojiModal, restoreEmojiModal } from "./modals"
import { Message } from "./message"
import type { Draft, Emoji, Model } from "./model"
import { EMOJI_NAME_ID } from "./update"

/** Port of `routes/_app/$orgSlug/settings/custom-emojis.tsx`. */

const DROP_ZONE_INPUT_ID = "custom-emoji-drop-zone-input"
const EMPTY_STATE_INPUT_ID = "custom-emoji-empty-state-input"

const isAdminOf = (shared: Shared) => shared.member?.role === "owner" || shared.member?.role === "admin"

/** React Aria FileTrigger's hidden input, rendered after its trigger. */
const fileInput = (h: HtmlBuilder<Message>, id: string): Html =>
	h.input([
		h.Id(id),
		h.Type("file"),
		h.Attribute("accept", ALLOWED_EMOJI_TYPES.join(",")),
		h.Attribute("class", ""),
		h.DataAttribute("rac", ""),
		h.Attribute("style", "display: none;"),
		h.OnFileChange((files) => Message.SelectedFiles({ files })),
	])

const dropZone = (h: HtmlBuilder<Message>, model: Model, isDisabled: boolean): Html =>
	h.div(
		[
			h.Class("rounded-lg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"),
			h.DataAttribute("rac", ""),
			...(model.isDropTarget ? [h.DataAttribute("drop-target", "true")] : []),
			...(isDisabled
				? [h.DataAttribute("disabled", "true")]
				: [
						h.AllowDrop(),
						h.OnDragEnter(Message.EnteredDropZone()),
						h.OnDragLeave(Message.LeftDropZone()),
						h.OnDropFiles((files) => Message.SelectedFiles({ files })),
					]),
		],
		[
			h.div(
				[h.Attribute("style", visuallyHiddenStyle)],
				[
					h.button([
						h.AriaLabel("DropZone"),
						h.Attribute("aria-labelledby", ""),
						h.DataAttribute("react-aria-pressable", "true"),
						h.Tabindex(0),
						h.Type("button"),
					]),
				],
			),
			h.button(
				[
					h.Class(
						cx(
							"flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 transition-colors",
							model.isDropTarget
								? "border-primary bg-primary/5"
								: "border-border bg-secondary/20 hover:border-muted-fg/40 hover:bg-secondary/40",
							isDisabled && "pointer-events-none opacity-50",
						),
					),
					h.DataAttribute("rac", ""),
					h.DataAttribute("react-aria-pressable", "true"),
					h.Tabindex(0),
					h.Type("button"),
					h.OnClick(Message.ClickedBrowse({ inputId: DROP_ZONE_INPUT_ID })),
				],
				[
					IconEmojiAdd(h, { className: "size-8 text-muted-fg" }),
					h.div(
						[h.Class("text-center")],
						[
							h.p([h.Class("font-medium text-fg text-sm")], ["Drop an image or click to browse"]),
							h.p([h.Class("mt-0.5 text-muted-fg text-xs")], ["PNG, GIF, or WebP · Max 256KB"]),
						],
					),
				],
			),
			fileInput(h, DROP_ZONE_INPUT_ID),
		],
	)

const draftForm = (h: HtmlBuilder<Message>, model: Model, draft: Draft): Html => {
	const busy = model.isSaving
	const isInvalid = draft.nameError !== null
	return h.div(
		[h.Class("rounded-lg border border-border bg-bg p-4")],
		[
			h.div(
				[h.Class("flex flex-col gap-4 sm:flex-row sm:items-start")],
				[
					h.div(
						[
							h.Class(
								"flex size-24 shrink-0 items-center justify-center self-center overflow-hidden rounded-lg bg-secondary sm:self-start",
							),
						],
						[h.img([h.Src(draft.previewUrl), h.Alt("Emoji preview"), h.Class("size-24 object-contain")])],
					),
					h.div(
						[h.Class("flex min-w-0 flex-1 flex-col gap-3")],
						[
							textField(
								h,
								{
									id: EMOJI_NAME_ID,
									value: draft.name,
									onInput: (value) => Message.ChangedEmojiName({ value }),
									isInvalid,
									isDisabled: busy,
								},
								(parts) => [
									parts.label(["Name"]),
									inputGroup(h, { isDisabled: busy, isInvalid }, [
										h.span([h.DataAttribute("slot", "text"), h.Class("text-muted-fg")], [":"]),
										parts.input({
											placeholder: "emoji_name",
											attributes: [h.Attribute("maxlength", "64")],
										}),
										h.span([h.DataAttribute("slot", "text"), h.Class("text-muted-fg")], [":"]),
									]),
									h.div(
										[h.Class("mt-1 flex items-center justify-between gap-2")],
										[
											draft.nameError !== null
												? parts.fieldError([draft.nameError])
												: parts.description([
														"Lowercase letters, numbers, hyphens, and underscores",
													]),
											h.span(
												[h.Class("shrink-0 text-muted-fg text-xs tabular-nums")],
												[`${draft.name.length}/64`],
											),
										],
									),
								],
							),
							h.div(
								[h.Class("flex items-center gap-2 sm:justify-end")],
								[
									button(
										h,
										{
											intent: "secondary",
											size: "sm",
											isDisabled: busy,
											onPress: Message.ClickedCancelUpload(),
										},
										["Cancel"],
									),
									button(
										h,
										{
											intent: "primary",
											size: "sm",
											isDisabled: busy || isInvalid || !draft.name,
											onPress: Message.ClickedSaveEmoji(),
										},
										[busy ? "Saving..." : "Save Emoji"],
									),
								],
							),
						],
					),
				],
			),
		],
	)
}

const headerCell = (h: HtmlBuilder<Message>, label: string, align: "left" | "right") =>
	h.th([h.Class(`px-4 py-3 text-${align} font-medium text-muted-fg text-xs`)], [label])

const table = (h: HtmlBuilder<Message>, rows: ReadonlyArray<Html>): Html =>
	h.div(
		[h.Class("overflow-x-auto")],
		[
			h.table(
				[h.Class("w-full min-w-full")],
				[
					h.thead(
						[h.Class("border-border border-b bg-bg")],
						[
							h.tr(
								[],
								[
									headerCell(h, "Emoji", "left"),
									headerCell(h, "Shortcode", "left"),
									headerCell(h, "Added by", "left"),
									headerCell(h, "Added", "left"),
									headerCell(h, "Actions", "right"),
								],
							),
						],
					),
					h.tbody([h.Class("divide-y divide-border")], [...rows]),
				],
			),
		],
	)

const pulse = (h: HtmlBuilder<Message>, className: string) =>
	h.td([h.Class("px-4 py-4")], [h.div([h.Class(`${className} animate-pulse rounded-sm bg-secondary`)], [])])

const skeletonRow = (h: HtmlBuilder<Message>, index: number): Html =>
	h.keyed("tr")(
		String(index),
		[],
		[
			pulse(h, "size-8"),
			pulse(h, "h-4 w-24"),
			pulse(h, "h-4 w-28"),
			pulse(h, "h-4 w-20"),
			h.td([h.Class("px-4 py-4 text-right")], [h.div([h.Class("size-8 animate-pulse rounded-sm bg-secondary")], [])]),
		],
	)

const emojiRow = (h: HtmlBuilder<Message>, emoji: Emoji, isAdmin: boolean, nowMs: number): Html =>
	h.keyed("tr")(
		emoji.id,
		[h.Class("hover:bg-secondary/50")],
		[
			h.td(
				[h.Class("px-4 py-4")],
				[h.img([h.Src(emoji.imageUrl), h.Alt(emoji.name), h.Class("size-8 rounded object-contain")])],
			),
			h.td([h.Class("px-4 py-4")], [h.span([h.Class("font-medium text-fg text-sm")], [":", emoji.name, ":"])]),
			h.td(
				[h.Class("px-4 py-4")],
				[h.span([h.Class("text-muted-fg text-sm")], [emoji.creatorFirstName, " ", emoji.creatorLastName])],
			),
			h.td(
				[h.Class("px-4 py-4")],
				[
					h.span(
						[h.Class("text-muted-fg text-sm")],
						[
							emoji.createdAtMs === null
								? "—"
								: formatDistanceToNow(new Date(emoji.createdAtMs), nowMs),
						],
					),
				],
			),
			h.td(
				[h.Class("px-4 py-4")],
				isAdmin
					? [
							h.div(
								[h.Class("flex justify-end")],
								[
									button(
										h,
										{
											intent: "danger",
											size: "sq-sm",
											onPress: Message.ClickedDeleteEmoji({ id: emoji.id, name: emoji.name }),
										},
										[IconTrash(h, { attributes: { "data-slot": "icon" } })],
									),
								],
							),
						]
					: [],
			),
		],
	)

const emojiList = (h: HtmlBuilder<Message>, model: Model, isAdmin: boolean, nowMs: number): Html => {
	if (model.emojis === null) return table(h, [0, 1, 2, 3, 4].map((index) => skeletonRow(h, index)))
	if (model.emojis.length === 0) {
		return emptyState(h, {
			icon: (className) => IconEmoji1(h, { className }),
			title: "No custom emojis yet",
			description: "Upload custom emojis to use in messages across your workspace.",
			...(isAdmin
				? {
						action: [
							button(
								h,
								{
									intent: "primary",
									size: "sm",
									onPress: Message.ClickedBrowse({ inputId: EMPTY_STATE_INPUT_ID }),
								},
								["Upload emoji"],
							),
							fileInput(h, EMPTY_STATE_INPUT_ID),
						],
					}
				: {}),
		})
	}
	return table(
		h,
		model.emojis.map((emoji) => emojiRow(h, emoji, isAdmin, nowMs)),
	)
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	if (shared.organization === null) return h.empty
	const isAdmin = isAdminOf(shared)
	const isPermissionsLoading = shared.member === null
	const count = model.emojis?.length ?? 0
	return h.div(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			card(h, {}, [
				cardHeader(h, [
					h.div(
						[h.Class("flex flex-col gap-0.5")],
						[
							h.div(
								[h.Class("flex items-center gap-2")],
								[
									IconEmoji1(h, { className: "size-5 text-muted-fg" }),
									h.h2([h.Class("font-semibold text-fg text-lg")], ["Custom Emojis"]),
									badge(h, { intent: "secondary" }, [`${count}`, " emoji", ...(count !== 1 ? ["s"] : [])]),
								],
							),
							h.p([h.Class("text-muted-fg text-sm")], ["Upload and manage custom emojis for your workspace."]),
						],
					),
				]),
				...(isAdmin || isPermissionsLoading
					? [
							h.div(
								[h.Class("border-border border-b px-4 py-4 md:px-6")],
								[
									model.draft === null
										? dropZone(h, model, isPermissionsLoading || !isAdmin)
										: draftForm(h, model, model.draft),
								],
							),
						]
					: []),
				emojiList(h, model, isAdmin, shared.nowMs),
			]),
			deleteEmojiModal(h, model),
			restoreEmojiModal(h, model),
		],
	)
})
