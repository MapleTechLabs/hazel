import { Label } from "~/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger } from "~/components/ui/select"
import { GallerySection } from "../frame"

export const title = "Select"

const options = [
	{ id: "never", label: "Don't clear" },
	{ id: "30m", label: "30 minutes" },
	{ id: "1h", label: "1 hour" },
	{ id: "today", label: "Today" },
	{ id: "week", label: "This week" },
] as const

const SelectExample = ({
	label,
	placeholder,
	defaultSelectedKey,
	isDisabled,
}: {
	label: string
	placeholder?: string
	defaultSelectedKey?: string
	isDisabled?: boolean
}) => (
	<Select
		className="w-64"
		placeholder={placeholder}
		defaultSelectedKey={defaultSelectedKey}
		isDisabled={isDisabled}
	>
		<Label>{label}</Label>
		<SelectTrigger />
		<SelectContent>
			{options.map((option) => (
				<SelectItem key={option.id} id={option.id}>
					{option.label}
				</SelectItem>
			))}
		</SelectContent>
	</Select>
)

export function Gallery() {
	return (
		<>
			<GallerySection title="States">
				<SelectExample label="Clear after" defaultSelectedKey="1h" />
				<SelectExample label="Reminder" placeholder="Choose a time" />
				<SelectExample label="Disabled" defaultSelectedKey="today" isDisabled />
			</GallerySection>
		</>
	)
}
