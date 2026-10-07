import { Separator } from "~/components/ui/separator"
import { GallerySection } from "../frame"

export const title = "Separator"

export function Gallery() {
	return (
		<>
			<GallerySection title="Horizontal">
				<div className="w-64">
					<p className="text-sm">Above</p>
					<Separator className="my-2" />
					<p className="text-sm">Below</p>
				</div>
			</GallerySection>
			<GallerySection title="Vertical">
				<div className="flex h-8 items-center gap-2 text-sm">
					<span>Left</span>
					<Separator orientation="vertical" />
					<span>Right</span>
				</div>
			</GallerySection>
		</>
	)
}
