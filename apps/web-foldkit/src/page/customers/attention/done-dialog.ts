import { SignalOutcome } from "@hazel/domain/customers"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { formatDate } from "../../../customers/format"
import { severityChip } from "../../../customers/ui/badges"
import { companyLogo } from "../../../customers/ui/identity"
import { IconArrowPath, IconCheck } from "../../../icons"
import { button } from "../../../ui/button"
import { dialogBody, dialogClose, dialogFooter, dialogHeader } from "../../../ui/dialog"
import * as Modal from "../../../ui/modal"
import { input } from "../../../ui/input"
import { textarea } from "../../../ui/textarea"
import { Message } from "./message"
import {
	accountsByIdOfModel,
	localDateOf,
	type Model,
	pickedSnoozeMs,
	signalById,
	type Viewer,
} from "./model"

/** "Mark signal as done" (Wonder: Queue Mark Done Dialog): outcome, note, and when it may come back. */

const toModalMessage = (message: Modal.Message) => Message.GotDoneModalMessage({ message })

const OUTCOMES = {
	contacted: ["Contacted", "Reached out to the account"],
	fixed: ["Fixed", "Root cause is resolved"],
	not_an_issue: ["Not an issue", "Expected or a false alarm"],
	other: ["Other", "Explain in the note"],
} as const satisfies Record<SignalOutcome, readonly [string, string]>

/** A signal marked done reopens after this if its condition still holds (`tech-design.md` §4.5). */
const REOPEN_AFTER_MS = 7 * 86_400_000

const outcomeCard = (h: HtmlBuilder<Message>, outcome: SignalOutcome, isSelected: boolean): Html => {
	const [label, description] = OUTCOMES[outcome]
	return h.button(
		[
			h.Type("button"),
			h.Role("radio"),
			h.AriaChecked(isSelected),
			h.OnClick(Message.ChangedDoneOutcome({ outcome })),
			h.Class(
				twMerge(
					"flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-left outline-hidden transition-colors hover:bg-wash focus-visible:ring-2 focus-visible:ring-ring/70",
					isSelected && "border-primary bg-primary-subtle/40",
				),
			),
		],
		[
			h.span(
				[
					h.Class(
						twMerge(
							"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border",
							isSelected && "border-primary",
						),
					),
				],
				isSelected ? [h.span([h.Class("size-2 rounded-full bg-primary")])] : [],
			),
			h.span(
				[h.Class("flex min-w-0 flex-1 flex-col")],
				[
					h.span([h.Class("font-medium text-fg text-sm")], [label]),
					h.span([h.Class("text-muted-fg text-xs")], [description]),
				],
			),
		],
	)
}

const content = (
	h: HtmlBuilder<Message>,
	model: Model,
	viewer: Viewer,
	closeAttributes: ReadonlyArray<ChildAttribute>,
): ReadonlyArray<Html> => {
	const form = model.doneForm
	const signal = signalById(model, form?.signalId ?? null)
	const account = signal === undefined ? undefined : accountsByIdOfModel(model).get(signal.accountId)
	if (form === null || signal === undefined || account === undefined) return []
	return [
		dialogHeader(h, {
			title: { id: Modal.titleId(model.doneModal.id), text: "Mark signal as done" },
			description: "What happened? Outcomes feed signal quality reports.",
		}),
		dialogBody(h, [
			h.div(
				[h.Class("flex flex-col gap-4")],
				[
					h.div(
						[h.Class("flex items-center gap-3 rounded-lg bg-secondary/50 px-3 py-2.5")],
						[
							companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "sm" }),
							h.div(
								[h.Class("flex min-w-0 flex-1 flex-col")],
								[
									h.span(
										[h.Class("truncate font-medium text-fg text-sm")],
										[`${account.name} · ${signal.title}`],
									),
									h.span([h.Class("truncate text-muted-fg text-xs")], [signal.reason]),
								],
							),
							severityChip(h, signal.severity),
						],
					),
					h.div(
						[h.Class("flex flex-col gap-2")],
						[
							h.span(
								[h.Id("done-outcome-label"), h.Class("font-medium text-fg text-sm")],
								["Outcome"],
							),
							h.div(
								[
									h.Role("radiogroup"),
									h.AriaLabelledBy("done-outcome-label"),
									h.Class("grid grid-cols-2 gap-2"),
								],
								SignalOutcome.literals.map((outcome) =>
									outcomeCard(h, outcome, outcome === form.outcome),
								),
							),
						],
					),
					h.label(
						[h.Class("flex flex-col gap-2")],
						[
							h.span(
								[h.Class("text-fg text-sm")],
								[
									h.span([h.Class("font-medium")], ["Note "]),
									h.span(
										[h.Class("text-muted-fg text-xs")],
										["Optional · saved to the customer timeline"],
									),
								],
							),
							textarea(h, {
								placeholder: "What did you do?",
								attributes: [
									h.Value(form.note),
									h.OnInput((value) => Message.ChangedDoneNote({ value })),
									h.Attribute("rows", "3"),
								],
							}),
						],
					),
					h.p(
						[
							h.Class(
								"flex items-start gap-2 rounded-lg bg-info-subtle px-3 py-2.5 text-info-subtle-fg text-xs",
							),
						],
						[
							IconArrowPath(h, { className: "mt-0.5 size-3.5 shrink-0" }),
							`If this is still true on ${formatDate(new Date(viewer.nowMs + REOPEN_AFTER_MS), { now: new Date(viewer.nowMs) })}, the signal reopens and returns to the queue.`,
						],
					),
				],
			),
		]),
		dialogFooter(h, [
			dialogClose(h, closeAttributes, ["Cancel"]),
			button(h, { onPress: Message.SubmittedDone() }, [
				IconCheck(h, { attributes: { "data-slot": "icon" } }),
				"Mark done",
			]),
		]),
	]
}

export const doneDialog = (h: HtmlBuilder<Message>, model: Model, viewer: Viewer): Html =>
	Modal.controlledModal(h, {
		model: model.doneModal,
		toParentMessage: toModalMessage,
		toContent: (closeAttributes) => content(h, model, viewer, closeAttributes),
		size: "md",
	})

// PICK DATE

const toSnoozeDateMessage = (message: Modal.Message) => Message.GotSnoozeDateModalMessage({ message })

/** "Pick date…" from the snooze menu: the day it comes back, at 9:00. */
export const snoozeDateDialog = (h: HtmlBuilder<Message>, model: Model, viewer: Viewer): Html =>
	Modal.controlledModal(h, {
		model: model.snoozeDateModal,
		toParentMessage: toSnoozeDateMessage,
		size: "sm",
		toContent: (closeAttributes) => {
			const form = model.snoozeDateForm
			const signal = signalById(model, form?.signalId ?? null)
			if (form === null || signal === undefined) return []
			const isValid = pickedSnoozeMs(form.date, viewer.nowMs) !== null
			return [
				dialogHeader(h, {
					title: { id: Modal.titleId(model.snoozeDateModal.id), text: "Snooze until" },
					description: `${signal.title}: back in the queue at 9:00 that day, or sooner if it gets worse.`,
				}),
				dialogBody(h, [
					input(h, {
						isInvalid: !isValid,
						attributes: [
							h.Type("date"),
							h.AriaLabel("Snooze until"),
							h.Value(form.date),
							h.Attribute("min", localDateOf(viewer.nowMs, 1)),
							h.OnInput((value) => Message.ChangedSnoozeDate({ value })),
						],
					}),
				]),
				dialogFooter(h, [
					dialogClose(h, closeAttributes, ["Cancel"]),
					button(h, { onPress: Message.SubmittedSnoozeDate(), isDisabled: !isValid }, ["Snooze"]),
				]),
			]
		},
	})
