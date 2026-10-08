import { announce } from "./announcer"

/**
 * RAC Button announces a focused button whose pending state flips, as an `img` labelled by the
 * button. One document observer follows `data-pending`, so buttons need no Mount. Installed on
 * import; `toast-view.ts` imports it because every root renders the toaster.
 */
let generatedIds = 0

/**
 * Disabling a focused button drops its focus before the observer runs; RAC reads the focus state
 * of the render that set pending. So the button last focused or pressed (usePress focuses it on
 * pointerdown) still counts while focus has fallen to the body and nothing else took it.
 */
let lastFocusedButton: HTMLButtonElement | null = null

const buttonOf = (target: EventTarget | null) => (target instanceof Element ? target.closest("button") : null)

const watchPendingButtons = () => {
	document.addEventListener(
		"focusin",
		(event) => {
			lastFocusedButton = event.target instanceof HTMLButtonElement ? event.target : null
		},
		true,
	)
	document.addEventListener(
		"pointerdown",
		(event) => {
			lastFocusedButton = buttonOf(event.target)
		},
		true,
	)
	const wasFocused = (element: HTMLButtonElement) =>
		document.activeElement === element ||
		(lastFocusedButton === element &&
			(document.activeElement === null || document.activeElement === document.body))
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
