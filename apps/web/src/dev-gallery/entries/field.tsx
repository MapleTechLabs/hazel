import { Description, FieldErrors, Fieldset, Label, Legend } from "~/components/ui/field"
import { Input } from "~/components/ui/input"
import { TextField } from "~/components/ui/text-field"
import { GallerySection } from "../frame"

export const title = "Field"

export function Gallery() {
	return (
		<>
			<GallerySection title="Parts">
				<div className="flex w-72 flex-col">
					<Label>Standalone label</Label>
					<Description>Standalone description text.</Description>
				</div>
				<div className="w-72">
					<FieldErrors
						errors={[
							{ message: "Name is required." },
							{ message: "Must be at least 3 characters." },
						]}
					/>
				</div>
			</GallerySection>
			<GallerySection title="Fieldset">
				<div className="w-96">
					<Fieldset>
						<Legend>Profile</Legend>
						<p data-slot="text" className="text-muted-fg text-sm">
							How others see you.
						</p>
						<TextField>
							<Label>Display name</Label>
							<Input placeholder="Ada" />
						</TextField>
					</Fieldset>
				</div>
			</GallerySection>
		</>
	)
}
