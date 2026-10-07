import { announce } from "./announcer"

/**
 * RAC Button announces a focused button whose pending state flips, as an `img` labelled by the
 * button. One document observer follows `data-pending`, so buttons need no Mount. Installed on
 * import; `toast-view.ts` imports it because every root renders the toaster.
 */
let generatedIds = 0

const watchPendingButtons = () => {
	const observer = new MutationObserver((records) => {
		records.forEach((record) => {
			const element = record.target
			const isPending = element instanceof Element && element.hasAttribute("data-pending")
			const wasPending = record.oldValue !== null
			if (
				element instanceof HTMLButtonElement &&
				isPending !== wasPending &&
				document.activeElement === element
			) {
				if (element.id === "") element.id = `react-aria-button-${++generatedIds}`
				announce({ labelledBy: element.id })
			}
		})
	})
	observer.observe(document.documentElement, {
		subtree: true,
		attributes: true,
		attributeOldValue: true,
		attributeFilter: ["data-pending"],
	})
}

if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") watchPendingButtons()
