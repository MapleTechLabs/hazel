/**
 * What Tab can reach inside an overlay (lane A3): the focus trap cycles through these, and an
 * overlay that opens moves focus to the first one.
 */

const tabbableSelector = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled]):not([type=hidden])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	"[tabindex]:not([tabindex='-1'])",
	"[contenteditable=''], [contenteditable='true']",
].join(", ")

/** Whether `element` is drawn: no `hidden` or `inert` ancestor, and (where the engine can tell) a box. */
export const isShown = (element: Element): boolean => {
	if (element.closest("[hidden], [inert]") !== null) return false
	const check = (element as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility
	return typeof check === "function" ? check.call(element) : true
}

/** Tab stops inside `root`, in document order. */
export const tabbables = (root: Element): ReadonlyArray<HTMLElement> =>
	[...root.querySelectorAll<HTMLElement>(tabbableSelector)].filter(isShown)

/** Focuses `element` without scrolling the page under an overlay. */
export const focusElement = (element: HTMLElement | null | undefined): boolean => {
	if (element === null || element === undefined || !element.isConnected) return false
	element.focus({ preventScroll: true })
	return element.ownerDocument.activeElement === element
}

/** The first tab stop in `root`, else `root` itself (made focusable with `tabindex=-1`). */
export const focusFirst = (root: HTMLElement): void => {
	const [first] = tabbables(root)
	if (first !== undefined && focusElement(first)) return
	if (!root.hasAttribute("tabindex")) root.tabIndex = -1
	focusElement(root)
}
