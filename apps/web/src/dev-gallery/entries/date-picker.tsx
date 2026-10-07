import { parseDate } from "@internationalized/date"
import { DatePicker, DatePickerTrigger } from "~/components/ui/date-picker"
import { Label } from "~/components/ui/field"
import { GallerySection } from "../frame"

export const title = "DatePicker"

export function Gallery() {
	return (
		<>
			<GallerySection title="With a value">
				<DatePicker
					aria-label="Clear status after"
					defaultValue={parseDate("2026-03-18")}
					className="w-64"
				>
					<DatePickerTrigger />
				</DatePicker>
			</GallerySection>
			<GallerySection title="With a label, empty">
				<DatePicker className="w-64">
					<Label>Due date</Label>
					<DatePickerTrigger />
				</DatePicker>
			</GallerySection>
		</>
	)
}
