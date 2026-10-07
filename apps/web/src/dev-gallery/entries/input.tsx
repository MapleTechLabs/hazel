import { IconMagnifier3 } from "~/components/icons/icon-magnifier-3"
import { Button } from "~/components/ui/button"
import { Input, InputGroup } from "~/components/ui/input"
import { Loader } from "~/components/ui/loader"
import { GallerySection } from "../frame"

export const title = "Input"

export function Gallery() {
	return (
		<>
			<GallerySection title="Plain">
				<div className="w-64">
					<Input aria-label="Name" placeholder="Placeholder" />
				</div>
				<div className="w-64">
					<Input aria-label="Filled" defaultValue="Ada Lovelace" />
				</div>
				<div className="w-64">
					<Input aria-label="Disabled" defaultValue="Disabled" disabled />
				</div>
				<div className="w-64">
					<Input aria-label="Invalid" defaultValue="Invalid" aria-invalid />
				</div>
			</GallerySection>
			<GallerySection title="Groups">
				<div className="w-64">
					<InputGroup>
						<IconMagnifier3 />
						<Input aria-label="Leading icon" placeholder="Search" />
					</InputGroup>
				</div>
				<div className="w-64">
					<InputGroup>
						<Input aria-label="Trailing loader" placeholder="Loading" />
						<Loader />
					</InputGroup>
				</div>
				<div className="w-64">
					<InputGroup>
						<span data-slot="text">https://</span>
						<Input aria-label="Prefix text" placeholder="example.com" />
					</InputGroup>
				</div>
				<div className="w-64">
					<InputGroup>
						<Input aria-label="With button" placeholder="Invite by email" />
						<Button intent="outline">Send</Button>
					</InputGroup>
				</div>
			</GallerySection>
		</>
	)
}
