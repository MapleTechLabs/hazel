import { Submodel } from "foldkit"
import { childAttributes } from "foldkit/html"
import {
	type Sides,
	sheetBackdropClassName,
	sheetCloseIconClassName,
	sheetContentStyles,
} from "~/components/ui/sheet.styles"
import { type DialogInputs, dialogView, type Message, type Model } from "./modal"

/**
 * A Modal with an edge-anchored panel: it shares the Modal Model, Message and update
 * (`Modal.init`, `Modal.update`); only the view differs.
 */

export type ViewInputs = DialogInputs &
	Readonly<{
		side?: Sides
		isFloat?: boolean
		/** Extra attributes on the panel (`data-slot`, `data-intent`). */
		panelAttributes?: Readonly<Record<string, string>>
	}>

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) =>
	dialogView(
		h,
		model,
		viewInputs,
		{
			backdropClassName: sheetBackdropClassName,
			layoutClassName: null,
			panelClassName: sheetContentStyles({
				side: viewInputs.side ?? "right",
				isFloat: viewInputs.isFloat ?? true,
			}),
			closeIconClassName: sheetCloseIconClassName,
			panelAttributes: childAttributes(
				Object.entries(viewInputs.panelAttributes ?? {}).map(([name, value]) =>
					h.Attribute(name, value),
				),
			),
		},
		(message) => message,
	),
)
