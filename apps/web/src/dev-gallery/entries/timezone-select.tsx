import { TimezoneSelect } from "~/components/ui/timezone-select"
import { GallerySection } from "../frame"

export const title = "Timezone select"

const ignore = () => undefined

export function Gallery() {
	return (
		<GallerySection title="Timezone select">
			<TimezoneSelect className="w-72" value="Europe/Berlin" onChange={ignore} />
			<TimezoneSelect className="w-72" onChange={ignore} />
		</GallerySection>
	)
}
