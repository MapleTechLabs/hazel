import { FieldValidationState, type ValidationState } from "~/components/ui/field-validation-state"
import { Input } from "~/components/ui/input"
import { GallerySection } from "../frame"

export const title = "Field validation state"

const states: ReadonlyArray<ValidationState> = ["idle", "validating", "valid", "invalid"]

export function Gallery() {
	return (
		<GallerySection title="States">
			{states.map((state) => (
				<div key={state} className="relative w-56">
					<Input aria-label={`Validation ${state}`} defaultValue={state} />
					<FieldValidationState state={state} />
				</div>
			))}
		</GallerySection>
	)
}
