import { Submodel } from "foldkit"
import type { PageViewInputs } from "../../../contract"
import { isCustomersAdmin } from "../shared"
import { detailView } from "./detail-view"
import { connectDialog, disconnectDialog, keysDialog } from "./dialogs"
import type { Message } from "./message"
import type { Model } from "./model"
import { overviewView } from "./overview-view"

/** Data sources: the overview, or one source's detail, plus the page's modals. */
export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const context = {
		orgSlug: shared.orgSlug ?? "",
		nowMs: shared.nowMs,
		isAdmin: isCustomersAdmin(shared),
		organizationId: shared.organization?.id ?? null,
	}
	return h.div(
		[h.Class("contents")],
		[
			model.provider === null
				? overviewView(h, model, context)
				: detailView(h, model, model.provider, context),
			connectDialog(h, model, context.organizationId),
			keysDialog(h, model),
			disconnectDialog(h, model),
		],
	)
})
