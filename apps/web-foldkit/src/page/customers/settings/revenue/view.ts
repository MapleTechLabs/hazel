import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { button } from "../../../../ui/button"
import { dialogClose, dialogFooter, dialogHeader } from "../../../../ui/dialog"
import { loader } from "../../../../ui/loader"
import * as Modal from "../../../../ui/modal"
import type { PageViewInputs } from "../../../contract"
import { isCustomersAdmin, readOnlyNotice, settingsHeader, settingsPage } from "../shared"
import { Message } from "./message"
import { draftOf, isDirty, type Model, restatesHistory, validOf } from "./model"
import { previewCard } from "./preview-view"
import { defaultsCard, rulesCard, windowCard } from "./rules-view"

/** Revenue settings: the variable MRR window, the ordered rules, the defaults and a live preview. */

type H = HtmlBuilder<Message>

const SUBTITLE =
	"What counts as recurring, variable or one-off revenue. These rules class every billing line, and MRR, run-rate MRR and revenue follow them."

const RESTATE_NOTE = "Saving restates the last 12 months of MRR history."

const unsavedBar = (h: H, model: Model, isValid: boolean): Html => {
	const restates = restatesHistory(model)
	return h.div(
		[
			h.Role("region"),
			h.AriaLabel("Unsaved changes"),
			h.Class(
				"sticky bottom-0 z-10 -mx-4 -mb-6 flex flex-wrap items-center gap-3 border-border border-t bg-bg/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8",
			),
		],
		[
			h.span([
				h.AriaHidden(true),
				h.Class(twMerge("size-2 rounded-full", isValid ? "bg-warning" : "bg-danger")),
			]),
			h.span(
				[h.Class("font-medium text-fg text-sm")],
				[isValid ? "Unsaved changes" : "Can't save yet"],
			),
			h.span(
				[h.Class("min-w-0 flex-1 truncate text-muted-fg text-sm")],
				[
					isValid
						? restates
							? RESTATE_NOTE
							: "Only names changed."
						: "Finish the highlighted rules",
				],
			),
			button(h, { intent: "plain", size: "sm", onPress: Message.PressedDiscard() }, ["Discard"]),
			button(
				h,
				{
					intent: "primary",
					size: "sm",
					isDisabled: !isValid,
					isPending: model.isSaving,
					onPress: Message.PressedSave(),
				},
				[restates ? "Save and restate" : "Save"],
			),
		],
	)
}

const confirmModal = (h: H, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.confirmModal,
		toParentMessage: (message) => Message.GotConfirmModalMessage({ message }),
		role: "alertdialog",
		size: "sm",
		toContent: (closeAttributes) => [
			dialogHeader(h, {
				title: {
					id: Modal.titleId(model.confirmModal.id),
					text: "Restate 12 months of MRR history?",
				},
				description:
					"The next compute rebuilds MRR movements and daily MRR for the last 12 months from your billing data under these rules. The change itself is never recorded as expansion or contraction.",
			}),
			dialogFooter(h, [
				dialogClose(h, closeAttributes, ["Cancel"]),
				button(h, { onPress: Message.PressedConfirmSave() }, ["Save and restate"]),
			]),
		],
	})

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const canEdit = isCustomersAdmin(shared)
	const draft = draftOf(model)
	const header = settingsHeader(h, { title: "Revenue", subtitle: SUBTITLE })
	if (draft === null)
		return settingsPage(h, [
			header,
			h.div(
				[h.Class("flex justify-center py-16")],
				[loader(h, { ariaLabel: "Loading revenue settings" })],
			),
		])
	const dirty = isDirty(model)
	return settingsPage(h, [
		header,
		...(canEdit ? [] : [readOnlyNotice(h, "revenue settings")]),
		windowCard(h, model, draft, canEdit),
		rulesCard(h, model, draft, canEdit),
		defaultsCard(h),
		previewCard(h, model, dirty),
		...(canEdit && dirty ? [unsavedBar(h, model, validOf(draft) !== null)] : []),
		confirmModal(h, model),
	])
})
