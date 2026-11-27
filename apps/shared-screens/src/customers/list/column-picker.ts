// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The customers list's column picker (today's `columnPicker` in `page/customers/list/controls.ts`):
 * the shown columns in order, each with a switch and up and down, then the hidden ones, and Reset.
 * Changes apply to the current view until it is saved.
 */
import * as Customers from "@hazel/domain/customers"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import { COLUMN_NAME, hiddenColumns, shownColumns } from "./columns"

export type ColumnPickerOptions<Msg> = Readonly<{
	columns: ReadonlyArray<Customers.ListColumn>
	onToggle: (column: Customers.ListColumn, shown: boolean) => Msg
	onMove: (column: Customers.ListColumn, step: -1 | 1) => Msg
	onReset: Msg
}>

type H<Msg> = Hazel.H<Msg>

const caption = <Msg>(h: H<Msg>, text: string) => h.text.role("caption").tone("muted").children(text)

// HAZEL-GAP(pk4a-switch-label-hidden): today the switch sits at the row's end after up and down, its label for assistive tech only; a `toggle` draws its label, so the row is the toggle and up and down follow it.
const switchRow = <Msg>(
	h: H<Msg>,
	options: ColumnPickerOptions<Msg>,
	column: Customers.ListColumn,
	shown: boolean,
) =>
	h.toggle
		.label(COLUMN_NAME[column])
		.checked(shown)
		.on("change", ({ checked }) => options.onToggle(column, checked))

// HAZEL-GAP(pk4a-chevron-up): today up is the down chevron turned over; the icon set has no `chevron-up`, so up is `arrow-up`.
const moveButton = <Msg>(
	h: H<Msg>,
	options: ColumnPickerOptions<Msg>,
	column: Customers.ListColumn,
	step: -1 | 1,
	disabled: boolean,
) =>
	h.button
		.key(`move-${step}`)
		.label(`Move ${COLUMN_NAME[column]} ${step === -1 ? "up" : "down"}`)
		.icon(step === -1 ? "arrow-up" : "chevron-down")
		.iconOnly()
		.variant("ghost")
		.size("xsmall")
		.disabled(disabled)
		.on("press", options.onMove(column, step))

export const columnPicker = <Msg>(h: H<Msg>, options: ColumnPickerOptions<Msg>) => {
	const shown = shownColumns(options.columns)
	const hidden = hiddenColumns(options.columns)
	return h.stack.density("compact").children(
		h.stack
			.axis("horizontal")
			.align("center")
			.children(
				h.stack
					.axis("horizontal")
					.density("tight")
					.children(
						h.text.strong().children("Columns"),
						h.text
							.tone("muted")
							.children(`${shown.length} of ${Customers.ListColumn.literals.length} shown`),
					),
				h.spacer,
				h.button.label("Reset").variant("ghost").size("xsmall").on("press", options.onReset),
			),
		caption(h, "Shown"),
		h.stack.density("none").children(
			...shown.map((column, index) =>
				column === "name"
					? h.stack
							.key(column)
							.axis("horizontal")
							.align("center")
							.children(
								h.text.children(COLUMN_NAME[column]),
								h.spacer,
								caption(h, "Always shown"),
							)
					: h.stack
							.key(column)
							.axis("horizontal")
							.align("center")
							.density("tight")
							.children(
								switchRow(h, options, column, true),
								moveButton(h, options, column, -1, index <= 1),
								moveButton(h, options, column, 1, index === shown.length - 1),
							),
			),
		),
		hidden.length === 0 ? null : caption(h, "Hidden"),
		hidden.length === 0
			? null
			: h.stack
					.density("none")
					.children(
						...hidden.map((column) =>
							h.stack.key(column).children(switchRow(h, options, column, false)),
						),
					),
		h.divider,
		caption(h, "Changes apply to this view. Use Save view to keep them."),
	)
}
