/** The web's implementations of the demo's extensions: only `ActivityChart` (a canvas). */
import { registerWebExtension } from "../web/extensions.ts"
import { ActivityChart } from "./extensions.ts"

/** Token colours for G1; the generated `tokens.css` replaces this. */
const tokenColor: Record<string, string> = {
	"brand.500": "#6938ef",
	"brand.300": "#bda5fa",
	"accent.400": "#9e77ed",
	"neutral.200": "#e4e4e7",
}

export const registerDemoWebExtensions = () =>
	registerWebExtension(ActivityChart, (container, props) => {
		const canvas = container.ownerDocument.createElement("canvas")
		canvas.width = 320
		canvas.height = 48
		canvas.setAttribute("role", "img")
		canvas.setAttribute("aria-label", "Recent activity")
		container.append(canvas)
		const draw = (values: ReadonlyArray<number>, color: string) => {
			// happy-dom has no 2D context: the element still mounts, it just draws nothing.
			const context = canvas.getContext?.("2d")
			if (context == null) return
			context.clearRect(0, 0, canvas.width, canvas.height)
			const max = Math.max(1, ...values)
			const width = canvas.width / Math.max(values.length, 1)
			context.fillStyle = tokenColor[color] ?? "#888"
			values.forEach((value, index) => {
				const height = (value / max) * (canvas.height - 4)
				context.beginPath()
				context.roundRect(index * width + 2, canvas.height - height, width - 4, height, 3)
				context.fill()
			})
		}
		draw(props.values, props.color)
		return {
			update: (next) => draw(next.values, next.color),
			dispose: () => canvas.remove(),
		}
	})
