import { announce } from "./announcer"

/**
 * RAC Button announces a focused button whose pending state flips, as an `img` labelled by the
 * button. One document observer follows `data-pending`, so buttons need no Mount. Installed on
 * import; `toast-view.ts` imports it because every root renders the toaster.
 */
let generatedIds = 0

/**
 * Disabling a focused button drops its focus before the observer runs (with or without a blur
 * event); RAC reads the focus state of the render that set pending, so the last focused button
 * still counts while nothing else took focus and it did not blur on its own.
 */
let lastFocusedButton: HTMLButtonElement | null = null

const watchPendingButtons = () => {
	document.addEventListener(
		"focusin",
		(event) => {
			lastFocusedButton = event.target instanceof HTMLButtonElement ? event.target : null
		},
		true,
	)
	document.addEventListener(
		"focusout",
		(event) => {
			const button = event.target
			if (button instanceof HTMLButtonElement && button === lastFocusedButton && !button.disabled)
				lastFocusedButton = null
		},
		true,
	)
	const wasFocused = (element: HTMLButtonElement) =>
		document.activeElement === element ||
		(lastFocusedButton === element && document.activeElement === document.body)
	const observer = new MutationObserver((records) => {
		records.forEach((record) => {
			const element = record.target
			const isPending = element instanceof Element && element.hasAttribute("data-pending")
			const wasPending = record.oldValue !== null
			if (element instanceof HTMLButtonElement && isPending !== wasPending && wasFocused(element)) {
				lastFocusedButton = null
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
