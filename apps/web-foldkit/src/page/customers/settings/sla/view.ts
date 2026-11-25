import { Submodel } from "foldkit"
import type { PageViewInputs } from "../../../contract"
import { isCustomersAdmin, readOnlyNotice, settingsPage } from "../shared"
import { pageHeader } from "../../../../ui/page-header"
import { editorView } from "./editor-view"
import { hoursCard } from "./hours-view"
import { deleteModal, policiesCard } from "./list-view"
import { triageCard } from "./triage-view"
import type { Message } from "./message"
import type { Model } from "./model"

const SUBTITLE =
	"How fast the team should answer and resolve a customer’s support issue, and what counts as one. Changes apply to issues opened from now on."

/** Support SLAs: the business hours and the policies, or the policy editor in their place. */
export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const canEdit = isCustomersAdmin(shared)
	if (model.editor !== null) return editorView(h, model, model.editor, shared, canEdit)
	return h.div(
		[h.Class("h-full")],
		[
			settingsPage(h, [
				pageHeader(h, { title: "Support SLAs", subtitle: SUBTITLE }),
				...(canEdit ? [] : [readOnlyNotice(h, "SLAs")]),
				hoursCard(h, model, canEdit),
				policiesCard(h, model, canEdit),
				triageCard(h, model, canEdit),
			]),
			deleteModal(h, model),
		],
	)
})
