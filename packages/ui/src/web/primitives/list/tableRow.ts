// Owned by lane A4 (phase 4, W8). `hz:tableRow`: a `<tr>` of its cells, after the select column's
// checkbox (shown while its table is `selectable`). `group` is a heading spanning every column
// (`title`), `footer` the totals row, `current` the screen's j/k row; `actions` show over the last cell.
import { definePrimitive, type Events, flag, part, type Primitive } from "../define.ts"
import { fire, textOf } from "./runtime.ts"
import { checkbox, ensureTableSheet, focusableRows, onRowSelect } from "./table-shared.ts"

export const primitive = definePrimitive("tableRow", ({ document, tag, outer }) => {
	ensureTableSheet(document)
	const node = outer("tr")
	node.setAttribute("role", "row")
	const selectCell = part(document, "td", "selectCell")
	const heading = part(document, "th", "heading")
	heading.setAttribute("scope", "colgroup")
	heading.setAttribute("role", "columnheader")

	let selected = false
	let disabled = false
	let title = ""
	const select = () => {
		if (!disabled) fire(primitive, "select", { selected: !selected })
	}
	const check = checkbox(document, "Select", select)
	// Named "Select <title>", or by the row's first cell while it has no title.
	selectCell.append(check.outer)
	node.append(selectCell, heading)
	onRowSelect(node, select)

	let named = ""
	const name = () => {
		const firstCell = node.querySelector<HTMLElement>(':scope > [data-hz="tableCell"]')
		const subject = title !== "" ? title : (firstCell?.textContent ?? "").trim()
		const next = subject === "" ? "Select row" : `Select ${subject}`
		if (next !== named) check.set("label", (named = next))
	}
	name()
	if (document.defaultView?.MutationObserver !== undefined)
		new document.defaultView.MutationObserver(name).observe(node, {
			childList: true,
			subtree: true,
			characterData: true,
		})

	// The keyboard on a focused row: arrows, Home and End move by row; Enter presses; Space selects
	// in a selectable table and presses otherwise.
	node.addEventListener("keydown", (event) => {
		if (event.target !== node || event.altKey) return
		const body = node.parentElement
		if (body === null) return
		const rows = focusableRows(body)
		const at = rows.indexOf(node)
		const move = (to: HTMLElement | undefined) => {
			if (to === undefined) return
			event.preventDefault()
			to.focus()
		}
		if (event.key === "ArrowDown") return move(rows[at + 1])
		if (event.key === "ArrowUp") return move(rows[at - 1])
		if (event.key === "Home") return move(rows[0])
		if (event.key === "End") return move(rows[rows.length - 1])
		if (disabled || event.metaKey || event.ctrlKey) return
		const selectable = node.closest('[data-hz="table"]')?.hasAttribute("data-selectable") === true
		if (event.key === " " && selectable) {
			event.preventDefault()
			return select()
		}
		if ((event.key === "Enter" || event.key === " ") && fire(primitive, "press")) event.preventDefault()
	})

	let events: Events | undefined
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (prop, value) => {
			if (prop === "title") {
				title = textOf(value)
				heading.textContent = title
				name()
			} else if (prop === "selected") {
				selected = value === true
				flag(node, "selected", value)
				check.set("checked", selected)
			} else if (prop === "disabled") {
				disabled = value === true
				flag(node, "disabled", value)
				check.set("disabled", disabled)
				if (disabled) node.setAttribute("aria-disabled", "true")
				else node.removeAttribute("aria-disabled")
			} else if (prop === "current" || prop === "group" || prop === "footer") flag(node, prop, value)
		},
		// A row the view presses points and joins the table's keyboard (`data-pressable`).
		get events() {
			return events
		},
		set events(next) {
			events = next
			flag(node, "pressable", next?.handlers.press !== undefined)
		},
	}
	return primitive
})
