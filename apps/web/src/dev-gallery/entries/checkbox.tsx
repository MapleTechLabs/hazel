import { Checkbox, CheckboxGroup } from "~/components/ui/checkbox"
import { Description, FieldError, Label } from "~/components/ui/field"
import { GallerySection } from "../frame"

export const title = "Checkbox"

export function Gallery() {
	return (
		<>
			<GallerySection title="States">
				<Checkbox>Unchecked</Checkbox>
				<Checkbox defaultSelected>Checked</Checkbox>
				<Checkbox isIndeterminate>Indeterminate</Checkbox>
				<Checkbox isDisabled>Disabled</Checkbox>
				<Checkbox isDisabled defaultSelected>
					Disabled checked
				</Checkbox>
				<Checkbox isInvalid>Invalid</Checkbox>
				<Checkbox isInvalid defaultSelected>
					Invalid checked
				</Checkbox>
			</GallerySection>
			<GallerySection title="With description">
				<div className="w-80">
					<Checkbox>
						<Label>Email notifications</Label>
						<Description>Get a digest of unread messages.</Description>
					</Checkbox>
				</div>
			</GallerySection>
			<GallerySection title="Group">
				<div className="w-80">
					<CheckboxGroup defaultValue={["mentions"]}>
						<Label>Notify me about</Label>
						<Checkbox value="mentions">Mentions</Checkbox>
						<Checkbox value="replies">Replies</Checkbox>
						<Checkbox value="reactions">Reactions</Checkbox>
					</CheckboxGroup>
				</div>
				<div className="w-80">
					<CheckboxGroup isInvalid>
						<Label>Accept the terms</Label>
						<Checkbox value="terms">I agree to the terms</Checkbox>
						<FieldError>You must accept the terms.</FieldError>
					</CheckboxGroup>
				</div>
			</GallerySection>
		</>
	)
}
