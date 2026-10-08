import { Button } from "~/components/ui/button"
import {
	Popover,
	PopoverBody,
	PopoverClose,
	PopoverContent,
	PopoverDescription,
	PopoverFooter,
	PopoverHeader,
	PopoverTitle,
} from "~/components/ui/popover"
import { GallerySection } from "../frame"

export const title = "Popover"

export function Gallery() {
	return (
		<>
			<GallerySection title="Popover">
				<Popover>
					<Button intent="outline">Details</Button>
					<PopoverContent>
						<PopoverHeader>
							<PopoverTitle>Notifications</PopoverTitle>
							<PopoverDescription>Choose when this channel notifies you.</PopoverDescription>
						</PopoverHeader>
						<PopoverBody>
							<p className="text-sm/6">Mentions and replies always notify you.</p>
						</PopoverBody>
						<PopoverFooter>
							<PopoverClose>Close</PopoverClose>
						</PopoverFooter>
					</PopoverContent>
				</Popover>
				<Popover>
					<Button intent="outline">With arrow</Button>
					<PopoverContent arrow placement="right">
						<PopoverHeader>
							<PopoverTitle>Pinned</PopoverTitle>
							<PopoverDescription>Two messages are pinned here.</PopoverDescription>
						</PopoverHeader>
					</PopoverContent>
				</Popover>
			</GallerySection>
		</>
	)
}
