import { Submodel } from "foldkit"
import { IconArrowPath } from "../../../../icons"
import { button } from "../../../../ui/button"
import { loader } from "../../../../ui/loader"
import type { PageViewInputs } from "../../../contract"
import { isCustomersAdmin, readOnlyNotice, settingsHeader, settingsPage } from "../shared"
import { componentCard, weightsCard } from "./components-view"
import type { Context } from "./fields"
import { Message } from "./message"
import {
	COMPONENTS,
	dataGapsOf,
	draftOf,
	invalidFieldsOf,
	isDirty,
	type Model,
	validDraftOf,
	weightTotal,
} from "./model"
import { bandsCard, checkCard, distributionCard, unsavedBar } from "./preview-view"

/** Health score settings (Wonder: Signals & Health Settings › `mao`, `aal`). */

const SUBTITLE =
	"How each customer’s 0–100 score is built. Recomputed every hour, and every customer page shows this same breakdown."

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const canEdit = isCustomersAdmin(shared)
	const draft = draftOf(model)
	if (model.settings === null || draft === null)
		return settingsPage(h, [
			settingsHeader(h, { title: "Health score", subtitle: SUBTITLE }),
			h.div(
				[h.Class("flex justify-center py-16")],
				[loader(h, { ariaLabel: "Loading health settings" })],
			),
		])
	const context: Context = {
		saved: model.settings.health,
		draft,
		invalid: invalidFieldsOf(draft),
		total: weightTotal(draft),
		isDirty: isDirty(model),
		canEdit,
	}
	const isValid = validDraftOf(model) !== null
	const gaps = model.accounts === null ? null : dataGapsOf(model.accounts)
	return settingsPage(h, [
		settingsHeader(h, {
			title: "Health score",
			subtitle: SUBTITLE,
			actions: canEdit
				? [
						button(
							h,
							{ intent: "outline", size: "sm", onPress: Message.PressedResetDefaults() },
							[IconArrowPath(h, { attributes: { "data-slot": "icon" } }), "Reset to defaults"],
						),
					]
				: [],
		}),
		...(canEdit ? [] : [readOnlyNotice(h, "the health score")]),
		weightsCard(h, context),
		h.div(
			[h.Class("grid grid-cols-1 gap-4 lg:grid-cols-2")],
			COMPONENTS.map((key) => componentCard(h, model, key, context, gaps)),
		),
		h.div(
			[h.Class("grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")],
			[
				bandsCard(h, model, context),
				distributionCard(h, model, context, isValid, model.settings.reportingCurrency),
			],
		),
		checkCard(h, model, context),
		...(canEdit && context.isDirty ? [unsavedBar(h, model, context, isValid)] : []),
	])
})
