import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconArrowUp, IconClock, IconEdit, IconPlus, IconTrash } from "../../../../icons"
import { badge } from "../../../../ui/badge"
import { button } from "../../../../ui/button"
import { dialogClose, dialogFooter, dialogHeader } from "../../../../ui/dialog"
import { emptyState } from "../../../../ui/empty-state"
import * as Modal from "../../../../ui/modal"
import { switchControl } from "../../../../ui/switch"
import { appliesToSummary, HOURS_LABEL, mediumTargetHint } from "./draft"
import { Message } from "./message"
import { type Model, type PolicyRow, policyById } from "./model"
import { card } from "./parts"

/** The ordered policies: first match wins. */

type H = HtmlBuilder<Message>

const icon = { attributes: { "data-slot": "icon" } }

const iconButton = (
	h: H,
	options: Readonly<{ label: string; onPress: Message; isDisabled?: boolean; icon: Html }>,
): Html =>
	button(
		h,
		{
			intent: "plain",
			size: "sq-sm",
			onPress: options.onPress,
			isDisabled: options.isDisabled ?? false,
			attributes: [h.AriaLabel(options.label), h.Title(options.label)],
		},
		[options.icon],
	)

const policyRow = (
	h: H,
	model: Model,
	policy: PolicyRow,
	index: number,
	count: number,
	canEdit: boolean,
): Html => {
	const isBusy = model.isWritingList
	return h.li(
		[h.Class("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-5")],
		[
			h.div(
				[h.Class("flex min-w-0 flex-1 basis-56 items-center gap-3")],
				[
					switchControl(
						h,
						{
							id: `sla-policy-${policy.id}`,
							isSelected: policy.enabled,
							isDisabled: !canEdit || isBusy,
							onChange: (enabled) => Message.ToggledPolicy({ policyId: policy.id, enabled }),
							className: "shrink-0 gap-x-0",
						},
						[h.span([h.Class("sr-only")], [policy.name])],
					),
					h.span(
						[
							h.AriaHidden(true),
							h.Class("w-5 shrink-0 text-right text-muted-fg text-xs tabular-nums"),
						],
						[String(index + 1)],
					),
					h.div(
						[
							h.Class(
								twMerge("flex min-w-0 flex-col gap-0.5", policy.enabled ? "" : "opacity-60"),
							),
						],
						[
							h.div(
								[h.Class("flex min-w-0 flex-wrap items-center gap-2")],
								[
									h.span([h.Class("truncate font-medium text-fg text-sm")], [policy.name]),
									badge(h, { intent: policy.hours === "always" ? "info" : "secondary" }, [
										HOURS_LABEL[policy.hours],
									]),
									...(policy.enabled ? [] : [badge(h, { intent: "outline" }, ["Off"])]),
								],
							),
							h.span(
								[h.Class("break-words text-muted-fg text-xs")],
								[appliesToSummary(policy.appliesTo, model.accounts)],
							),
							h.span(
								[
									h.Class(
										"inline-flex items-center gap-1 text-muted-fg text-xs tabular-nums",
									),
								],
								[
									IconClock(h, { className: "size-3 shrink-0" }),
									mediumTargetHint(policy.targets),
								],
							),
						],
					),
				],
			),
			h.div(
				[h.Class("ml-auto flex shrink-0 items-center gap-0.5")],
				canEdit
					? [
							iconButton(h, {
								label: `Move ${policy.name} up`,
								onPress: Message.PressedMove({ policyId: policy.id, offset: -1 }),
								isDisabled: index === 0 || isBusy,
								icon: IconArrowUp(h, icon),
							}),
							iconButton(h, {
								label: `Move ${policy.name} down`,
								onPress: Message.PressedMove({ policyId: policy.id, offset: 1 }),
								isDisabled: index === count - 1 || isBusy,
								icon: IconArrowUp(h, { ...icon, className: "rotate-180" }),
							}),
							iconButton(h, {
								label: `Edit ${policy.name}`,
								onPress: Message.PressedEdit({ policyId: policy.id }),
								icon: IconEdit(h, icon),
							}),
							iconButton(h, {
								label: `Delete ${policy.name}`,
								onPress: Message.PressedDelete({ policyId: policy.id }),
								icon: IconTrash(h, icon),
							}),
						]
					: [
							button(
								h,
								{
									intent: "outline",
									size: "sm",
									onPress: Message.PressedEdit({ policyId: policy.id }),
								},
								["View"],
							),
						],
			),
		],
	)
}

const newPolicyButton = (h: H): Html =>
	button(h, { intent: "outline", size: "sm", onPress: Message.PressedNewPolicy() }, [
		IconPlus(h, icon),
		"New policy",
	])

export const deleteModal = (h: H, model: Model): Html => {
	const policy = policyById(model, model.deletingPolicyId)
	return Modal.controlledModal(h, {
		model: model.deleteModal,
		toParentMessage: (message) => Message.GotDeleteModalMessage({ message }),
		role: "alertdialog",
		size: "sm",
		toContent: (closeAttributes) => [
			dialogHeader(h, {
				title: { id: Modal.titleId(model.deleteModal.id), text: "Delete this policy?" },
				description: `“${policy?.name ?? "This policy"}” stops applying to new issues. Open issues keep the targets they started with.`,
			}),
			dialogFooter(h, [
				dialogClose(h, closeAttributes, ["Cancel"]),
				button(h, { intent: "danger", onPress: Message.PressedConfirmDelete() }, ["Delete policy"]),
			]),
		],
	})
}

export const policiesCard = (h: H, model: Model, canEdit: boolean): Html => {
	const policies = model.policies ?? []
	return card(
		h,
		{
			title: "Policies",
			description:
				"First match wins, top to bottom. A customer named directly wins over a plan or tag.",
			aside: canEdit && policies.length > 0 ? newPolicyButton(h) : null,
			isFlush: true,
		},
		[
			model.policies === null
				? h.p(
						[h.Class("border-border border-t px-5 py-10 text-center text-muted-fg text-sm")],
						["Loading policies…"],
					)
				: policies.length === 0
					? emptyState(h, {
							title: "No SLA: issues have no targets",
							icon: (className) => IconClock(h, { className }),
							description: "Add a policy to set reply and resolution targets.",
							action: canEdit ? newPolicyButton(h) : undefined,
							className: "border-border border-t",
						})
					: h.ol(
							[
								h.AriaLabel("Policies, first match first"),
								h.Class("divide-y divide-border border-border border-t"),
							],
							policies.map((policy, index) =>
								policyRow(h, model, policy, index, policies.length, canEdit),
							),
						),
		],
	)
}
