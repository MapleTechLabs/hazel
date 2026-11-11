import { Submodel } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { commonMessage, type CommonReason } from "~/lib/error-messages"
import { IconArrowPath, IconCube } from "../../../../icons"
import { button } from "../../../../ui/button"
import { emptyState } from "../../../../ui/empty-state"
import { loader } from "../../../../ui/loader"
import { switchControl } from "../../../../ui/switch"
import type { PageViewInputs } from "../../../contract"
import { isCustomersAdmin, readOnlyNotice, settingsHeader, settingsPage } from "../shared"
import { Message } from "./message"
import { type Model, planNamesOf } from "./model"

const SUBTITLE =
	"Mark the plans billed on top of a base plan. A customer’s plan is its base plan; add-ons still count toward its MRR."

const CARD = "flex flex-col rounded-xl border border-border bg-bg"

const planRow = (h: HtmlBuilder<Message>, plan: string, isAddOn: boolean, canEdit: boolean): Html => {
	const id = `customers-plan-${plan}`
	return h.li(
		[h.Class("flex items-center justify-between gap-4 px-4 py-3 sm:px-5")],
		[
			h.label([h.For(id), h.Class("min-w-0 break-words font-medium text-fg text-sm")], [plan]),
			switchControl(
				h,
				{
					id,
					isSelected: isAddOn,
					isDisabled: !canEdit,
					onChange: (isSelected) => Message.ToggledAddOn({ plan, isAddOn: isSelected }),
				},
				"Add-on",
			),
		],
	)
}

const plansCard = (h: HtmlBuilder<Message>, model: Model, canEdit: boolean): Html => {
	const plans = planNamesOf(model)
	const addOns = new Set(model.settings?.addOnPlans ?? [])
	if (plans.length === 0)
		return emptyState(h, {
			title: "No plans yet",
			icon: (className) => IconCube(h, { className }),
			description: "Plans show up here once a billing source has synced subscriptions.",
			className: CARD,
		})
	return h.ul(
		[h.Class(`${CARD} divide-y divide-border`)],
		plans.map((plan) => planRow(h, plan, addOns.has(plan), canEdit && !model.isSaving)),
	)
}

const failure = (h: HtmlBuilder<Message>, reason: CommonReason): Html => {
	const message = commonMessage(reason)
	return h.div(
		[h.Class(`items-center gap-3 px-6 py-14 text-center ${CARD}`)],
		[
			h.span([h.Class("font-medium text-fg")], [message.title]),
			...(message.description
				? [h.span([h.Class("text-muted-fg text-sm")], [message.description])]
				: []),
			button(h, { intent: "outline", size: "sm", onPress: Message.PressedRetry() }, [
				IconArrowPath(h, { attributes: { "data-slot": "icon" } }),
				"Try again",
			]),
		],
	)
}

/** Plans settings: a switch per plan name marks it an add-on. */
export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const canEdit = isCustomersAdmin(shared)
	return settingsPage(h, [
		settingsHeader(h, { title: "Plans", subtitle: SUBTITLE }),
		...(canEdit ? [] : [readOnlyNotice(h, "plans")]),
		AsyncData.isFailure(model.plans)
			? failure(h, model.plans.error)
			: model.settings === null || AsyncData.isIdle(model.plans) || AsyncData.isLoading(model.plans)
				? h.div([h.Class("flex justify-center py-16")], [loader(h, { ariaLabel: "Loading plans" })])
				: plansCard(h, model, canEdit),
	])
})
