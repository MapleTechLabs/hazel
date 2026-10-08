/**
 * React processes a controlled input's change before the next keystroke; Foldkit can defer a
 * busy Message queue to the next task, so a render may write back a value the user has already
 * typed past and drop a keystroke. This keeps the typed values whose Messages are still in
 * flight and skips the model writes that only echo one of them; any other write goes through.
 */
const valueProperty =
	typeof HTMLInputElement === "undefined"
		? undefined
		: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")

export const keepTypedValue = (element: Element): (() => void) => {
	if (
		!(element instanceof HTMLInputElement) ||
		valueProperty?.get === undefined ||
		valueProperty.set === undefined
	)
		return () => undefined
	const { get, set } = valueProperty
	let typed: Array<string> = []
	const onInput = () => {
		typed.push(get.call(element))
	}
	const onBlur = () => {
		typed = []
	}
	Object.defineProperty(element, "value", {
		configurable: true,
		get: () => get.call(element),
		set: (value: string) => {
			const index = typed.indexOf(value)
			if (index === -1) {
				typed = []
				set.call(element, value)
				return
			}
			// The model caught up to this keystroke (a render may write it more than once); the later
			// ones are still on their way, so only the latest typed value is written through.
			typed = typed.slice(index)
			if (typed.length === 1) set.call(element, value)
		},
	})
	element.addEventListener("input", onInput)
	element.addEventListener("blur", onBlur)
	return () => {
		element.removeEventListener("input", onInput)
		element.removeEventListener("blur", onBlur)
		Reflect.deleteProperty(element, "value")
	}
}
