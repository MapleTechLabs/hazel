// Owned by lane A4. Drag and keyboard reorder for `list.reorderable` and `section.reorderable`:
// the rows stay where the renderer put them; a drop raises `move {id, before}` and the view reorders.
import { rowId } from "./runtime.ts"

export interface Reorder {
	/** Re-applies `draggable` to the current rows (after children change). */
	readonly sync: () => void
}

/**
 * Wires `container`'s rows for reordering while `enabled()`. A drop, or Alt+ArrowUp/Down on a
 * focused row, calls `move` with the row's id and the id it now precedes (null: the end).
 */
export const attachReorder = (options: {
	readonly container: HTMLElement
	readonly rows: () => ReadonlyArray<HTMLElement>
	readonly enabled: () => boolean
	readonly move: (id: string, before: string | null) => void
}): Reorder => {
	const { container } = options
	let dragging: HTMLElement | undefined

	const sync = () => {
		const on = options.enabled()
		for (const row of options.rows()) {
			if (on) row.setAttribute("draggable", "true")
			else row.removeAttribute("draggable")
		}
	}

	const rowFrom = (target: EventTarget | null): HTMLElement | undefined => {
		const rows = options.rows()
		let node = target instanceof Node ? target : null
		while (node !== null && node !== container) {
			if (node instanceof HTMLElement && rows.includes(node)) return node
			node = node.parentNode
		}
		return undefined
	}

	/** The row the pointer is above the middle of, or undefined for the end. */
	const beforeAt = (y: number): HTMLElement | undefined =>
		options.rows().find((row) => {
			const box = row.getBoundingClientRect()
			return y < box.top + box.height / 2
		})

	const clearMarks = () => {
		for (const row of options.rows()) delete row.dataset.dropBefore
		delete container.dataset.dropEnd
	}

	const commit = (row: HTMLElement, before: HTMLElement | undefined) => {
		const rows = options.rows()
		const from = rows.indexOf(row)
		const to = before === undefined ? rows.length : rows.indexOf(before)
		// Dropped on itself or just below itself: nothing moves.
		if (from < 0 || to === from || to === from + 1) return
		options.move(rowId(row, from), before === undefined ? null : rowId(before, rows.indexOf(before)))
	}

	container.addEventListener("dragstart", (event) => {
		if (!options.enabled()) return
		const row = rowFrom(event.target)
		if (row === undefined) return
		dragging = row
		row.dataset.dragging = ""
		if (event.dataTransfer !== null) {
			event.dataTransfer.effectAllowed = "move"
			event.dataTransfer.setData("text/plain", row.textContent ?? "")
			const box = row.getBoundingClientRect()
			event.dataTransfer.setDragImage(row, event.clientX - box.left, event.clientY - box.top)
		}
	})
	container.addEventListener("dragover", (event) => {
		if (dragging === undefined) return
		event.preventDefault()
		if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move"
		clearMarks()
		const before = beforeAt(event.clientY)
		if (before === undefined) container.dataset.dropEnd = ""
		else before.dataset.dropBefore = ""
	})
	container.addEventListener("dragleave", (event) => {
		if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return
		clearMarks()
	})
	container.addEventListener("drop", (event) => {
		const row = dragging
		if (row === undefined) return
		event.preventDefault()
		commit(row, beforeAt(event.clientY))
		clearMarks()
	})
	container.addEventListener("dragend", () => {
		if (dragging !== undefined) delete dragging.dataset.dragging
		dragging = undefined
		clearMarks()
	})
	container.addEventListener("keydown", (event) => {
		if (!options.enabled() || !event.altKey) return
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
		const row = rowFrom(event.target)
		if (row === undefined) return
		const rows = options.rows()
		const at = rows.indexOf(row)
		if (event.key === "ArrowUp" && at > 0) commit(row, rows[at - 1])
		else if (event.key === "ArrowDown" && at < rows.length - 1) commit(row, rows[at + 2])
		else return
		event.preventDefault()
	})

	return { sync }
}

/** The drop line, drawn by the renderer over the row it lands before (or under the last). */
export const reorderCss = (scope: string) => `
${scope} > [draggable="true"] { cursor: grab; }
${scope} > [data-dragging] { opacity: 0.5; }
${scope} > [data-drop-before] { box-shadow: 0 calc(-1 * var(--hz-space-0_5)) 0 0 var(--hz-color-ring); }
${scope}[data-drop-end] > [draggable="true"]:last-of-type { box-shadow: 0 var(--hz-space-0_5) 0 0 var(--hz-color-ring); }
`
