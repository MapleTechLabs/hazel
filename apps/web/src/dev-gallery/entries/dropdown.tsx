import { IconCopy } from "~/components/icons/icon-copy"
import { IconEdit } from "~/components/icons/icon-edit"
import { IconTrash } from "~/components/icons/icon-trash"
import {
	DropdownDescription,
	DropdownItem,
	DropdownKeyboard,
	DropdownLabel,
	DropdownSection,
	DropdownSeparator,
} from "~/components/ui/dropdown"
import { ListBox } from "~/components/ui/list-box"
import { GallerySection } from "../frame"

export const title = "Dropdown"

export function Gallery() {
	return (
		<>
			<GallerySection title="Items and sections">
				<ListBox
					aria-label="Message actions"
					selectionMode="single"
					defaultSelectedKeys={["edit"]}
					className="w-72"
				>
					<DropdownSection title="Message">
						<DropdownItem id="edit" textValue="Edit">
							<IconEdit data-slot="icon" />
							<DropdownLabel>Edit</DropdownLabel>
							<DropdownKeyboard>E</DropdownKeyboard>
						</DropdownItem>
						<DropdownItem id="copy" textValue="Copy text">
							<IconCopy data-slot="icon" />
							<DropdownLabel>Copy text</DropdownLabel>
							<DropdownKeyboard>⌘C</DropdownKeyboard>
						</DropdownItem>
					</DropdownSection>
					<DropdownSeparator />
					<DropdownSection title="Danger zone">
						<DropdownItem id="delete" textValue="Delete" intent="danger">
							<IconTrash data-slot="icon" />
							<DropdownLabel>Delete</DropdownLabel>
							<DropdownDescription>Removes it for everyone</DropdownDescription>
						</DropdownItem>
						<DropdownItem id="archive" textValue="Archive" intent="warning" isDisabled>
							Archive
						</DropdownItem>
					</DropdownSection>
				</ListBox>
			</GallerySection>
		</>
	)
}
