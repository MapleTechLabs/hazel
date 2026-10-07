import { parseDate } from "@internationalized/date"
import { RangeCalendar } from "~/components/ui/range-calendar"
import { GallerySection } from "../frame"

export const title = "RangeCalendar"

export function Gallery() {
	return (
		<GallerySection title="Selected range">
			<RangeCalendar
				aria-label="Trip dates"
				defaultValue={{ start: parseDate("2026-03-09"), end: parseDate("2026-03-13") }}
			/>
		</GallerySection>
	)
}
