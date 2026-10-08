import { Description, FieldError, Label } from "~/components/ui/field"
import { TextField } from "~/components/ui/text-field"
import { Textarea } from "~/components/ui/textarea"
import { GallerySection } from "../frame"

export const title = "Textarea"

export function Gallery() {
	return (
		<>
			<GallerySection title="Textareas">
				<div className="w-80">
					<TextField>
						<Label>Message</Label>
						<Textarea placeholder="Write something" />
					</TextField>
				</div>
				<div className="w-80">
					<TextField defaultValue={"Line one\nLine two\nLine three"}>
						<Label>Notes</Label>
						<Textarea />
						<Description>Grows with its content.</Description>
					</TextField>
				</div>
			</GallerySection>
			<GallerySection title="States">
				<div className="w-80">
					<TextField isInvalid defaultValue="Too short">
						<Label>Invalid</Label>
						<Textarea />
						<FieldError>Write at least 20 characters.</FieldError>
					</TextField>
				</div>
				<div className="w-80">
					<TextField isDisabled defaultValue="Disabled text">
						<Label>Disabled</Label>
						<Textarea />
					</TextField>
				</div>
			</GallerySection>
		</>
	)
}
