// @vitest-environment happy-dom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Renderer } from "@effect/ui"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { TextFieldDemo } from "../demo/TextFieldDemo.ts"
import * as WebHost from "./host.ts"

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

const container = () => {
	document.body.innerHTML = ""
	const element = document.createElement("div")
	document.body.append(element)
	return element
}

/** One keystroke as the browser delivers it: the input's text changes, then `input` fires. */
const type = (input: HTMLInputElement, text: string) => {
	for (const char of text) {
		input.value += char
		input.dispatchEvent(new Event("input", { bubbles: true }))
	}
}
const enter = (input: HTMLInputElement) =>
	input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))

describe("hz:textField on the web", () => {
	it("round-trips a real input through the Model: typing, #tag transform, submit and clear", async () => {
		const root = container()
		await Effect.gen(function* () {
			const app = yield* Renderer.mount(TextFieldDemo, {}, root)
			yield* Effect.promise(settle)
			const field = root.querySelector("[data-hz=textField]")!
			const input = field.querySelector("label[data-hz-part=label] > input") as HTMLInputElement
			expect(field.querySelector("[data-hz-part=caption]")?.textContent).toBe("Message")
			expect(input.placeholder).toBe("Type, #tags go upper case")

			// A burst with no turn of the scheduler in between: no echo lands mid-burst.
			type(input, "hello there ")
			type(input, "world")
			expect(input.value).toBe("hello there world")
			yield* Effect.promise(settle)
			expect(input.value).toBe("hello there world")
			expect(app.model()?.field.text).toBe("hello there world")

			// A Model transform comes back into the input while typing continues.
			type(input, " #ship")
			yield* Effect.promise(settle)
			expect(input.value).toBe("hello there world #SHIP")
			type(input, " it  ")

			// Submit trims and clears; the next keystrokes land in the cleared field.
			enter(input)
			type(input, "n")
			yield* Effect.promise(settle)
			expect(app.model()?.sent).toEqual(["hello there world #SHIP it"])
			expect(input.value).toBe("n")
			expect(app.model()?.field.text).toBe("n")

			// An empty submit shows the error, wired to the input.
			input.value = ""
			input.dispatchEvent(new Event("input", { bubbles: true }))
			enter(input)
			yield* Effect.promise(settle)
			const error = field.querySelector("[data-hz-part=error]") as HTMLElement
			expect(error.hidden).toBe(false)
			expect(error.textContent).toBe("Type something first")
			expect(input.getAttribute("aria-describedby")).toBe(error.id)
			expect(root.querySelectorAll("[data-hz=item]")).toHaveLength(1)
		}).pipe(Effect.provide(WebHost.layer()), Effect.scoped, Effect.runPromise)
	})
})
