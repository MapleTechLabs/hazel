import { parseDate } from "@internationalized/date"
import { Calendar } from "~/components/ui/calendar"
import { GallerySection } from "../frame"

export const title = "Calendar"

export function Gallery() {
	return (
		<>
			<GallerySection title="Selected date">
				<Calendar aria-label="Event date" defaultValue={parseDate("2026-03-18")} />
			</GallerySection>
			<GallerySection title="Minimum date">
				<Calendar aria-label="Deadline" minValue={parseDate("2026-03-10")} />
			</GallerySection>
		</>
	)
}
