import { Button } from "~/components/ui/button"
import {
	Sheet,
	SheetBody,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "~/components/ui/sheet"
import { GallerySection } from "../frame"

export const title = "Sheet"

export function Gallery() {
	return (
		<>
			<GallerySection title="Sheet">
				<Sheet>
					<Button intent="outline">Open sheet</Button>
					<SheetContent>
						<SheetHeader>
							<SheetTitle>Channel details</SheetTitle>
							<SheetDescription>Members, files and settings for this channel.</SheetDescription>
						</SheetHeader>
						<SheetBody>
							<p className="text-sm/6">Twelve members have access to this channel.</p>
						</SheetBody>
						<SheetFooter>
							<SheetClose>Close</SheetClose>
						</SheetFooter>
					</SheetContent>
				</Sheet>
				<Sheet>
					<Button intent="outline">Open left sheet</Button>
					<SheetContent side="left" isFloat={false}>
						<SheetHeader title="Navigation" description="Jump to a channel." />
					</SheetContent>
				</Sheet>
			</GallerySection>
		</>
	)
}
