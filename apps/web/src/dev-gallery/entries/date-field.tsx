import { parseDate } from "@internationalized/date"
import { DateField, DateInput } from "~/components/ui/date-field"
import { Description, FieldError, Label } from "~/components/ui/field"
import { GallerySection } from "../frame"

export const title = "Date field"

export function Gallery() {
	return (
		<>
			<GallerySection title="Fields">
				<DateField>
					<Label>Start date</Label>
					<DateInput />
				</DateField>
				<DateField defaultValue={parseDate("2026-10-07")}>
					<Label>Due date</Label>
					<DateInput />
					<Description>When the task is due.</Description>
				</DateField>
			</GallerySection>
			<GallerySection title="States">
				<DateField isDisabled defaultValue={parseDate("2026-01-15")}>
					<Label>Disabled</Label>
					<DateInput />
				</DateField>
				<DateField isInvalid defaultValue={parseDate("2026-02-28")}>
					<Label>Invalid</Label>
					<DateInput />
					<FieldError>Pick a weekday.</FieldError>
				</DateField>
			</GallerySection>
		</>
	)
}
