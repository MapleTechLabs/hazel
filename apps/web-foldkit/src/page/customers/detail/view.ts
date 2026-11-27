import { Option } from "effect"
import { Submodel } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { button } from "../../../ui/button"
import { dialogFooter, dialogClose, dialogHeader } from "../../../ui/dialog"
import * as Modal from "../../../ui/modal"
import type { PageViewInputs } from "../../contract"
import { isCustomersAdmin } from "../settings/shared"
import { activityTab } from "./activity-tab"
import { billingTab } from "./billing-tab"
import { impersonateDialog } from "./impersonate-dialog"
import { Message } from "./message"
import { accountOf, type Model } from "./model"
import { notesTab } from "./notes-tab"
import { overviewTab } from "./overview-tab"
import type { Context } from "./parts"
import { usersTab } from "./users-tab"

/**
 * The customer page's tab content (Overview, Users, Billing, Activity, Notes) with the tabs' own
 * dialogs. The header, details panel and the More menu's dialogs are native
 * (`shared-screens/src/customers/pages/CustomerDetailPage.ts`), which adopts this as its `tab` slot;
 * PK6a and PK6b move the tabs and then delete this page.
 */

const deleteNoteDialog = (h: HtmlBuilder<Message>, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.deleteNoteModal,
		toParentMessage: (message) => Message.GotDeleteNoteModalMessage({ message }),
		role: "alertdialog",
		size: "sm",
		toContent: (closeAttributes) => [
			dialogHeader(h, {
				title: { id: Modal.titleId(model.deleteNoteModal.id), text: "Delete this note?" },
				description: "It's removed for everyone. This can't be undone.",
			}),
			dialogFooter(h, [
				dialogClose(h, closeAttributes, ["Cancel"]),
				button(h, { intent: "danger", onPress: Message.PressedConfirmDeleteNote() }, ["Delete note"]),
			]),
		],
	})

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const account = accountOf(model)
	if (account === undefined) return h.div([])
	const context: Context = {
		orgSlug: shared.orgSlug ?? "",
		nowMs: shared.nowMs,
		userId: shared.currentUser?.id ?? null,
		account,
		detail: Option.getOrNull(AsyncData.getData(model.detail)),
		membersById: new Map(model.members.map((member) => [member.id, member])),
		isAdmin: isCustomersAdmin(shared),
	}
	const body =
		model.tab === "users"
			? usersTab(h, model, context)
			: model.tab === "billing"
				? billingTab(h, model, context)
				: model.tab === "activity"
					? activityTab(h, model, context)
					: model.tab === "notes"
						? notesTab(h, model, context, shared.organization?.name ?? "your workspace")
						: overviewTab(h, model, context)
	return h.div(
		[h.Class("flex flex-col gap-4")],
		[...body, deleteNoteDialog(h, model), impersonateDialog(h, model)],
	)
})
