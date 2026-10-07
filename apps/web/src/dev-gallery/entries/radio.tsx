import { Description, FieldError, Label } from "~/components/ui/field"
import { Radio, RadioGroup } from "~/components/ui/radio"
import { GallerySection } from "../frame"

export const title = "Radio"

export function Gallery() {
	return (
		<>
			<GallerySection title="Groups">
				<div className="w-72">
					<RadioGroup defaultValue="comfortable">
						<Label>Density</Label>
						<Radio value="compact">Compact</Radio>
						<Radio value="comfortable">Comfortable</Radio>
						<Radio value="spacious">Spacious</Radio>
					</RadioGroup>
				</div>
				<div className="w-72">
					<RadioGroup>
						<Label>Theme</Label>
						<Description>Applies to every device.</Description>
						<Radio value="light">Light</Radio>
						<Radio value="dark">Dark</Radio>
					</RadioGroup>
				</div>
			</GallerySection>
			<GallerySection title="States">
				<div className="w-72">
					<RadioGroup isDisabled defaultValue="on">
						<Label>Disabled</Label>
						<Radio value="on">Disabled selected</Radio>
						<Radio value="off">Disabled</Radio>
					</RadioGroup>
				</div>
				<div className="w-72">
					<RadioGroup isInvalid>
						<Label>Invalid</Label>
						<Radio value="yes">Yes</Radio>
						<Radio value="no">No</Radio>
						<FieldError>Pick one.</FieldError>
					</RadioGroup>
				</div>
			</GallerySection>
		</>
	)
}
