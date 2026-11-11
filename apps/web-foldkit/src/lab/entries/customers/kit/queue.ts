import { Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { IconCheck, IconClock, IconDots, IconUser } from "../../../../icons"
import { button } from "../../../../ui/button"
import { formatRelative, type Instant } from "../../../../customers/format"
import { evidenceViz } from "../../../../customers/ui/evidence"
import { queueAction, queueList, queueRow } from "../../../../customers/ui/queue-row"
import { QUEUE_SHORTCUTS, shortcutBar } from "../../../../customers/ui/shortcuts"
import { defineLab } from "../../../define"
import { labPage, labSection } from "../../../frame"
import { NOW, OPEN_ENTRIES, memberOf } from "../../../fixtures/customers"

// `/lab/customers/kit/queue`: Foundations › Queue Row Signal States. Hover a row for its actions,
// click to select it, move the keyboard cursor with the buttons.

const Model = Schema.Struct({ focused: Schema.Number, selected: Schema.NullOr(Schema.String) })
type Model = typeof Model.Type

const Message = defineMessageUnion({
	MovedFocus: { by: Schema.Number },
	PressedRow: { id: Schema.String },
	Ignored: {},
})
type Message = typeof Message.Type

const update = (model: Model, message: Message): { model: Model } => ({
	model: Message.match(message, {
		MovedFocus: ({ by }) => ({
			...model,
			focused: Math.min(OPEN_ENTRIES.length - 1, Math.max(0, model.focused + by)),
		}),
		PressedRow: ({ id }) => ({ ...model, selected: model.selected === id ? null : id }),
		Ignored: () => model,
	}),
})

/** `2d`, `6h`: the age column. */
const age = (openedAt: Instant) => formatRelative(openedAt, NOW).replace(" ago", "")

const actions = (h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
	queueAction(h, { label: "Assign", icon: IconUser(h), onPress: Message.Ignored() }),
	queueAction(h, { label: "Snooze", icon: IconClock(h), onPress: Message.Ignored() }),
	queueAction(h, { label: "Done", icon: IconCheck(h), onPress: Message.Ignored() }),
	queueAction(h, { label: "More actions", icon: IconDots(h), iconOnly: true, onPress: Message.Ignored() }),
]

const view = (model: Model, h: HtmlBuilder<Message>): Html =>
	labPage(h, { title: "Queue rows" }, [
		labSection(h, "Default · hover with actions · opportunity · keyboard focus · selected", [
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					button(h, { intent: "outline", size: "xs", onPress: Message.MovedFocus({ by: -1 }) }, [
						"k ↑",
					]),
					button(h, { intent: "outline", size: "xs", onPress: Message.MovedFocus({ by: 1 }) }, [
						"j ↓",
					]),
					h.span([h.Class("text-muted-fg text-xs")], [`Cursor on row ${model.focused + 1}`]),
				],
			),
			queueList(
				h,
				{ ariaLabel: "Needs attention" },
				OPEN_ENTRIES.map(({ signal, account }, index) => {
					return queueRow(h, {
						id: `queue-${signal.id}`,
						rank: index + 1,
						account: {
							name: account.name,
							logoUrl: account.logoUrl,
							planName: account.planName,
							mrrMinor: account.mrrMinor,
							currency: account.currency,
						},
						signal: {
							kind: signal.kind,
							severity: signal.severity,
							title: signal.title,
							reason: signal.reason,
						},
						evidence: evidenceViz(h, signal.evidence),
						age: age(signal.openedAt),
						assignee: memberOf(signal.assigneeUserId),
						health: { status: account.healthStatus, score: account.healthScore },
						isFocused: index === model.focused,
						isSelected: signal.id === model.selected,
						onPress: Message.PressedRow({ id: signal.id }),
						actions: actions(h),
					})
				}),
			),
			shortcutBar(h, QUEUE_SHORTCUTS),
		]),
	])

export const lab = defineLab("Queue rows", {
	Model,
	init: () => ({ model: { focused: 3, selected: null } }),
	update,
	view,
})
