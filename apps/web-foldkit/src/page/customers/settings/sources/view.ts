import { Submodel } from "foldkit"
import type { PageViewInputs } from "../../../contract"
import { isCustomersAdmin } from "../shared"
import { detailView } from "./detail-view"
import { disconnectDialog, keysDialog } from "./dialogs"
import type { Message } from "./message"
import type { Model } from "./model"

/** One source's detail, plus its modals (connecting is the native modal). */
export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const context = {
		orgSlug: shared.orgSlug ?? "",
		nowMs: shared.nowMs,
		isAdmin: isCustomersAdmin(shared),
		organizationId: shared.organization?.id ?? null,
	}
	return h.div(
		[h.Class("contents")],
		[detailView(h, model, model.provider, context), keysDialog(h, model), disconnectDialog(h, model)],
	)
})
