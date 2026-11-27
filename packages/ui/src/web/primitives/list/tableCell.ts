// Owned by lane A4 (phase 4, W8). `hz:tableCell`: a `<td>` holding any elements; its table aligns and
// sizes it by `column` (or by position while it names none).
import { definePrimitive, option } from "../define.ts"
import { ensureTableSheet } from "./table-shared.ts"

export const primitive = definePrimitive("tableCell", ({ document, outer, self }) => {
	ensureTableSheet(document)
	const node = outer("td")
	return self(node, (name, value) => {
		if (name === "column") option(node, "column", value)
	})
})
