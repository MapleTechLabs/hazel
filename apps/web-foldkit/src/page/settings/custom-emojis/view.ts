import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { cx } from "~/utils/cx"
import { IconEmoji1, IconEmojiAdd, IconTrash } from "../../../icons"
import { visuallyHiddenStyle } from "../../../ui/checkbox"
import { badge } from "../../../ui/badge"
import { ariaButton, button } from "../../../ui/button"
import { card, cardClassName, cardHeader } from "../../../ui/card"
import { emptyState } from "../../../ui/empty-state"
import { inputGroup } from "../../../ui/input"
import { textField } from "../../../ui/text-field"
import type { PageViewInputs, Shared } from "../../contract"
import { formatDistanceToNow } from "~/lib/format-distance"
import * as DropZone from "../../shared/drop-zone"
import { ALLOWED_EMOJI_TYPES } from "../upload"
import { deleteEmojiModal, restoreEmojiModal } from "./modals"
import { Message } from "./message"
import type { Draft, Emoji, Model } from "./model"
import { EMOJI_NAME_ID, isBusy } from "./update"
import { pageHeader, pageLayout } from "../../../ui/page-header"
import { type Column, dataTable } from "../../../ui/data-table"

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
		h.Attribute("style", "display: none;"),
		h.OnFileChange((files) => Message.SelectedFiles({ files })),
	])

const dropZone = (h: HtmlBuilder<Message>, model: Model, isDisabled: boolean): Html =>
	h.div(
		[
			h.Class(
				"rounded-lg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
			),
			...(isDisabled
				? [h.DataAttribute("disabled", "true")]
				: DropZone.zoneAttributes(
						h,
						model.dropZone,
						(message) => Message.GotDropZoneMessage({ message }),
						(files) => Message.SelectedFiles({ files }),
					)),
		],
		[
			h.div(
				[h.Attribute("style", visuallyHiddenStyle)],
				[
					ariaButton(
						h,
						{ attributes: [h.AriaLabel("DropZone"), h.Attribute("aria-labelledby", "")] },
						[],
					),
				],
			),
			ariaButton(
				h,
				{
					className: cx(
						"flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 transition-colors",
						model.dropZone.isOver
							? "border-primary bg-primary/5"
							: "border-border bg-secondary/20 hover:border-muted-fg/40 hover:bg-secondary/40",
						isDisabled && "pointer-events-none opacity-50",
					),
					onPress: Message.ClickedBrowse({ inputId: DROP_ZONE_INPUT_ID }),
				},
				[
					IconEmojiAdd(h, { className: "size-8 text-muted-fg" }),
					h.div(
						[h.Class("text-center")],
						[
							h.p(
								[h.Class("font-medium text-fg text-sm")],
								["Drop an image or click to browse"],
							),
							h.p([h.Class("mt-0.5 text-muted-fg text-xs")], ["PNG, GIF, or WebP · Max 256KB"]),
						],
					),
				],
			),
			fileInput(h, DROP_ZONE_INPUT_ID),
		],
	)

const draftForm = (h: HtmlBuilder<Message>, model: Model, draft: Draft): Html => {
	const busy = isBusy(model)
	const nameError = draft.name._tag === "Invalid" ? draft.name.errors[0] : null
	const isInvalid = nameError !== null
	return h.div(
		[h.Class(cardClassName("p-4"))],
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
						[
							h.img([
								h.Src(draft.previewUrl),
								h.Alt("Emoji preview"),
								h.Class("size-24 object-contain"),
							]),
						],
					),
					h.div(
						[h.Class("flex min-w-0 flex-1 flex-col gap-3")],
						[
							textField(
								h,
								{
									id: EMOJI_NAME_ID,
									value: draft.name.value,
									onInput: (value) => Message.ChangedEmojiName({ value }),
									isInvalid,
									isDisabled: busy,
								},
								(parts) => [
									parts.label(["Name"]),
									inputGroup(h, { isDisabled: busy, isInvalid }, [
										h.span(
											[h.DataAttribute("slot", "text"), h.Class("text-muted-fg")],
											[":"],
										),
										parts.input({
											placeholder: "emoji_name",
											attributes: [h.Attribute("maxlength", "64")],
										}),
										h.span(
											[h.DataAttribute("slot", "text"), h.Class("text-muted-fg")],
											[":"],
										),
									]),
									h.div(
										[h.Class("mt-1 flex items-center justify-between gap-2")],
										[
											nameError !== null
												? parts.fieldError([nameError])
												: parts.description([
														"Lowercase letters, numbers, hyphens, and underscores",
													]),
											h.span(
												[h.Class("shrink-0 text-muted-fg text-xs tabular-nums")],
												[`${draft.name.value.length}/64`],
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
											isDisabled: busy || isInvalid || !draft.name.value,
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

const columns = (h: HtmlBuilder<Message>, isAdmin: boolean, nowMs: number): ReadonlyArray<Column<Emoji>> => [
	{
		key: "emoji",
		label: "Emoji",
		widthClass: "w-20",
		cell: (emoji) =>
			h.img([h.Src(emoji.imageUrl), h.Alt(emoji.name), h.Class("size-8 rounded object-contain")]),
	},
	{
		key: "shortcode",
		label: "Shortcode",
		cell: (emoji) => h.span([h.Class("font-medium")], [":", emoji.name, ":"]),
	},
	{
		key: "creator",
		label: "Added by",
		hideClass: "max-md:hidden",
		widthClass: "w-48",
		cell: (emoji) =>
			h.span([h.Class("text-muted-fg")], [emoji.creatorFirstName, " ", emoji.creatorLastName]),
	},
	{
		key: "added",
		label: "Added",
		hideClass: "max-md:hidden",
		widthClass: "w-36",
		cell: (emoji) =>
			h.span(
				[h.Class("text-muted-fg")],
				[emoji.createdAtMs === null ? "—" : formatDistanceToNow(new Date(emoji.createdAtMs), nowMs)],
			),
	},
	{
		key: "actions",
		label: "Actions",
		align: "right",
		widthClass: "w-24",
		cell: (emoji) =>
			isAdmin
				? button(
						h,
						{
							intent: "danger",
							size: "sq-sm",
							onPress: Message.ClickedDeleteEmoji({ id: emoji.id, name: emoji.name }),
							attributes: [h.AriaLabel(`Delete :${emoji.name}:`)],
						},
						[IconTrash(h, { attributes: { "data-slot": "icon" } })],
					)
				: "",
	},
]

const emojiTable = (
	h: HtmlBuilder<Message>,
	emojis: ReadonlyArray<Emoji> | null,
	isAdmin: boolean,
	nowMs: number,
): Html =>
	dataTable(h, {
		ariaLabel: "Custom emojis",
		id: "custom-emojis",
		columns: columns(h, isAdmin, nowMs),
		rows: emojis ?? [],
		rowKey: (emoji) => emoji.id,
		isFramed: false,
		loadingRows: emojis === null ? 5 : undefined,
	})

const emojiList = (h: HtmlBuilder<Message>, model: Model, isAdmin: boolean, nowMs: number): Html => {
	if (model.emojis === null) return emojiTable(h, null, isAdmin, nowMs)
	if (model.emojis.length === 0) {
		return emptyState(h, {
			icon: (className) => IconEmoji1(h, { className }),
			title: "No custom emojis yet",
			description: "Upload custom emojis to use in messages across your workspace.",
			action: isAdmin
				? [
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
					]
				: undefined,
		})
	}
	return emojiTable(h, model.emojis, isAdmin, nowMs)
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	if (shared.organization === null) return h.empty
	const isAdmin = isAdminOf(shared)
	const isPermissionsLoading = shared.member === null
	const count = model.emojis?.length ?? 0
	return pageLayout(h, {}, [
		card(h, {}, [
			cardHeader(h, [
				pageHeader(h, {
					title: "Custom Emojis",
					size: "title",
					leading: IconEmoji1(h, { className: "mt-0.5 size-5 text-muted-fg" }),
					badges: [
						badge(h, { intent: "secondary" }, [
							`${count}`,
							" emoji",
							...(count !== 1 ? ["s"] : []),
						]),
					],
					subtitle: "Upload and manage custom emojis for your workspace.",
				}),
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
	])
})
