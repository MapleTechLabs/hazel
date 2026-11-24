import { Submodel } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { commonMessage, type CommonReason } from "~/lib/error-messages"
import { IconArrowPath, IconCube } from "../../../../icons"
import { button } from "../../../../ui/button"
import { emptyState } from "../../../../ui/empty-state"
import { cardClassName } from "../../../../ui/card"
import { label } from "../../../../ui/field"
import { loadingState } from "../../../../ui/loader"
import { switchControl } from "../../../../ui/switch"
import type { PageViewInputs } from "../../../contract"
import { isCustomersAdmin, readOnlyNotice, settingsPage } from "../shared"
import { pageHeader } from "../../../../ui/page-header"
import { Message } from "./message"
import { type Model, planNamesOf } from "./model"

const SUBTITLE =
	"Which plans are add-ons billed on top of a base plan. A customer’s plan is its base plan; add-ons still count toward its MRR."

const planRow = (h: HtmlBuilder<Message>, plan: string, isAddOn: boolean, canEdit: boolean): Html => {
	const id = `customers-plan-${plan}`
	return h.li(
		[h.Class("flex items-center justify-between gap-4 px-4 py-3 sm:px-5")],
		[
			label(h, { htmlFor: id, className: "min-w-0 break-words font-medium sm:text-sm" }, [plan]),
			switchControl(
				h,
				{
					id,
					isSelected: isAddOn,
					isDisabled: !canEdit,
					onChange: (isSelected) => Message.ToggledAddOn({ plan, isAddOn: isSelected }),
					className: "shrink-0",
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
			className: cardClassName(),
		})
	return h.ul(
		[h.Class(cardClassName("flex flex-col divide-y divide-border"))],
		plans.map((plan) => planRow(h, plan, addOns.has(plan), canEdit && !model.isSaving)),
	)
}

const failure = (h: HtmlBuilder<Message>, reason: CommonReason): Html => {
	const message = commonMessage(reason)
	return emptyState(h, {
		title: message.title,
		description: message.description,
		className: cardClassName("px-6 py-14"),
		action: button(h, { intent: "outline", size: "sm", onPress: Message.PressedRetry() }, [
			IconArrowPath(h, { attributes: { "data-slot": "icon" } }),
			"Try again",
		]),
	})
}

/** Plans settings: a switch per plan name marks it an add-on. */
export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const canEdit = isCustomersAdmin(shared)
	return settingsPage(h, [
		pageHeader(h, { title: "Plans", subtitle: SUBTITLE }),
		...(canEdit ? [] : [readOnlyNotice(h, "plans")]),
		AsyncData.isFailure(model.plans)
			? failure(h, model.plans.error)
			: model.settings === null || AsyncData.isIdle(model.plans) || AsyncData.isLoading(model.plans)
				? loadingState(h, { label: "Loading plans", className: "py-16" })
				: plansCard(h, model, canEdit),
	])
})
