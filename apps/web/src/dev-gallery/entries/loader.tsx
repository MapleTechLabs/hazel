import { Loader } from "~/components/ui/loader"
import { GallerySection } from "../frame"

export const title = "Loader"

export function Gallery() {
	return (
		<>
			<GallerySection title="Ring">
				<Loader variant="ring" aria-label="Loading ring" />
				<Loader variant="ring" aria-label="Loading large ring" className="size-6 text-primary" />
			</GallerySection>
			<GallerySection title="Spin">
				<Loader aria-label="Spinning" />
				<Loader aria-label="Spinning large" className="size-8 text-muted-fg" />
			</GallerySection>
		</>
	)
}
