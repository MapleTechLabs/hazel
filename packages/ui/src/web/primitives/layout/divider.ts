// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { definePrimitive } from "../define.ts"

export const primitive = definePrimitive("divider", ({ outer, self }) => {
	// `hr` is a separator to assistive technology; the recipe draws its hairline.
	return self(outer("hr"), () => {})
})
