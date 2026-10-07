import { Time } from "@internationalized/date"
import { DateInput } from "~/components/ui/date-field"
import { Label } from "~/components/ui/field"
import { TimeField } from "~/components/ui/time-field"
import { GallerySection } from "../frame"

export const title = "Time field"

export function Gallery() {
	return (
		<>
			<GallerySection title="Fields">
				<TimeField defaultValue={new Time(22, 0)}>
					<Label>Start time</Label>
					<DateInput />
				</TimeField>
				<TimeField>
					<Label>Reminder</Label>
					<DateInput />
				</TimeField>
				<TimeField defaultValue={new Time(8, 30)} isDisabled>
					<Label>Disabled</Label>
					<DateInput />
				</TimeField>
			</GallerySection>
		</>
	)
}
