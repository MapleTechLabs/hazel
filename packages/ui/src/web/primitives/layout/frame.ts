// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { definePrimitive, option } from "../define.ts"
import { ensureSheet } from "../list/runtime.ts"

// `hint` (`frame-hint`, `create-channel-hint.ts`): a 14px muted icon, a 20px close button with a 14px
// glyph (28px with 12px from `sm`), and its small key cap only where keys are (`hidden lg:inline-flex`).
const H = '[data-hz="frame"][data-surface="hint"]'
const css = `
${H} [data-hz="icon"] { width: var(--hz-space-3_5); height: var(--hz-space-3_5); color: var(--hz-color-muted-fg); }
${H} [data-hz="button"][data-icon-only] {
	width: var(--hz-space-5); height: var(--hz-space-5); min-width: 0; min-height: 0; padding: 0; flex-shrink: 0;
}
${H} [data-hz="button"][data-icon-only] > [data-hz-part="icon"] { width: var(--hz-space-3_5); height: var(--hz-space-3_5); }
@media (width >= 40rem) {
	${H} [data-hz="button"][data-icon-only] { width: var(--hz-space-7); height: var(--hz-space-7); }
	${H} [data-hz="button"][data-icon-only] > [data-hz-part="icon"] { width: var(--hz-space-3); height: var(--hz-space-3); }
}
/* Its key cap is the kit's \`sm\` (\`h-4.5 min-w-4.5 px-1 text-3xs\`). */
${H} [data-hz="text"][data-role="kbd"] {
	min-height: var(--hz-space-4_5); min-width: var(--hz-space-4_5); padding-inline: var(--hz-space-1);
	font-size: var(--hz-text-micro-size); line-height: calc(4 / 3);
}
@media (width < 64rem) { ${H} [data-hz="text"][data-role="kbd"] { display: none; } }
`

export const primitive = definePrimitive("frame", ({ document, outer, self }) => {
	ensureSheet(document, "frame", css)
	const node = outer("div")
	return self(node, (name, value) => {
		if (name === "surface") option(node, "surface", value)
	})
})
