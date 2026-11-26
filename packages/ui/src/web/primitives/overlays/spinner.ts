/**
 * The loading spinner a toast and the command palette draw (today's `ui/toast-view.ts` loading icon):
 * a faint ring with a turning quarter arc. No `primitive` export, so the registry glob skips this file.
 */
import { part } from "../define.ts"

const ARC =
	'<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.25" stroke-width="3"/><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>'

// HAZEL-GAP(motion-spin): the turn (today's `animate-spin`, 1s linear, looping) is renderer CSS, not a named motion.
const css = `
@keyframes hz-spinner-turn { to { rotate: 360deg; } }
[data-hz-spinner] { display: block; flex-shrink: 0; }
[data-hz-spinner][hidden] { display: none; }
[data-hz-spinner] > svg { display: block; width: 100%; height: 100%; animation: hz-spinner-turn 1s linear infinite; }
/* Today's \`mt-0.5\`: the ring sits on the title's first line. */
[data-hz=toast] [data-hz-spinner] { margin-top: var(--hz-space-0_5); }
@media (prefers-reduced-motion: reduce) { [data-hz-spinner] > svg { animation: none; } }
`

const installed = new WeakSet<Document>()

/** A spinner as the part `name` of its primitive (its size and colour are the recipe's). */
export const spinner = (document: Document, name: string): HTMLElement => {
	if (!installed.has(document)) {
		installed.add(document)
		const style = document.createElement("style")
		style.dataset.hzSpinner = ""
		style.textContent = css
		;(document.head ?? document.documentElement).append(style)
	}
	const node = part(document, "span", name)
	node.dataset.hzSpinner = ""
	node.innerHTML = ARC
	return node
}
