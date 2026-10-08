import { Description, FieldError, Label } from "~/components/ui/field"
import { Input } from "~/components/ui/input"
import { TextField } from "~/components/ui/text-field"
import { GallerySection } from "../frame"

export const title = "Text field"

export function Gallery() {
	return (
		<>
			<GallerySection title="Fields">
				<div className="w-72">
					<TextField>
						<Label>Name</Label>
						<Input placeholder="Ada Lovelace" />
					</TextField>
				</div>
				<div className="w-72">
					<TextField defaultValue="ada@hazel.sh">
						<Label>Email</Label>
						<Input />
						<Description>We never share your email.</Description>
					</TextField>
				</div>
				<div className="w-72">
					<TextField>
						<Label>Username</Label>
						<Description>Lowercase letters and numbers.</Description>
						<Input placeholder="ada" />
					</TextField>
				</div>
			</GallerySection>
			<GallerySection title="States">
				<div className="w-72">
					<TextField isInvalid defaultValue="not-an-email">
						<Label>Invalid</Label>
						<Input />
						<FieldError>Enter a valid email address.</FieldError>
					</TextField>
				</div>
				<div className="w-72">
					<TextField isDisabled defaultValue="Read only value">
						<Label>Disabled</Label>
						<Input />
						<Description>This field is disabled.</Description>
					</TextField>
				</div>
				<div className="w-72">
					<TextField isRequired>
						<Label>Required</Label>
						<Input placeholder="Required" />
					</TextField>
				</div>
			</GallerySection>
		</>
	)
}
