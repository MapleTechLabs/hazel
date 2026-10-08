import { useState } from "react"
import { IconHashtag } from "~/components/icons/icon-hashtag"
import { IconLock } from "~/components/icons/icon-lock"
import { Button } from "~/components/ui/button"
import { CommandMenu } from "~/components/ui/command-menu"
import {
	CommandMenuFormBody,
	CommandMenuFormContainer,
	CommandMenuFormField,
	CommandMenuFormFooter,
	CommandMenuFormHeader,
	CommandMenuInput,
	CommandMenuToggle,
} from "~/components/ui/command-menu-form"
import { GallerySection } from "../frame"

export const title = "Command menu form"

const visibilityOptions = [
	{ value: "public", label: "Public", icon: <IconHashtag className="size-4" /> },
	{ value: "private", label: "Private", icon: <IconLock className="size-4" /> },
]

export function Gallery() {
	const [isOpen, setIsOpen] = useState(false)
	const [visibility, setVisibility] = useState("public")
	return (
		<GallerySection title="Command menu form">
			<Button intent="outline" onPress={() => setIsOpen(true)}>
				Create channel
			</Button>
			<CommandMenu isOpen={isOpen} onOpenChange={setIsOpen} isFormPage>
				<CommandMenuFormContainer>
					<CommandMenuFormHeader
						title="Create channel"
						subtitle="Channels are where your team talks"
						onBack={() => setIsOpen(false)}
					/>
					<CommandMenuFormBody className="space-y-3">
						<CommandMenuFormField label="Name">
							<CommandMenuInput
								aria-label="Name"
								placeholder="e.g. design-reviews"
								icon={<IconHashtag className="size-4" />}
							/>
						</CommandMenuFormField>
						<CommandMenuFormField
							label="Visibility"
							error="Private channels need at least one member."
						>
							<CommandMenuToggle
								value={visibility}
								onChange={setVisibility}
								options={visibilityOptions}
							/>
						</CommandMenuFormField>
					</CommandMenuFormBody>
					<CommandMenuFormFooter>
						<span>
							<kbd>↵</kbd> to create
						</span>
						<Button size="xs">Create</Button>
					</CommandMenuFormFooter>
				</CommandMenuFormContainer>
			</CommandMenu>
		</GallerySection>
	)
}
