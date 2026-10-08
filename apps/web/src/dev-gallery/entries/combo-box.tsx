import { ComboBox, ComboBoxContent, ComboBoxInput, ComboBoxItem } from "~/components/ui/combo-box"
import { Label } from "~/components/ui/field"
import { GallerySection } from "../frame"

export const title = "Combo box"

const channels = [
	{ id: "general", name: "General" },
	{ id: "design", name: "Design" },
	{ id: "engineering", name: "Engineering" },
	{ id: "random", name: "Random" },
	{ id: "product", name: "Product updates" },
]

export function Gallery() {
	return (
		<GallerySection title="Combo box">
			<ComboBox className="w-64">
				<Label>Channel</Label>
				<ComboBoxInput placeholder="Search channels" />
				<ComboBoxContent items={channels}>
					{(channel) => (
						<ComboBoxItem id={channel.id} textValue={channel.name}>
							{channel.name}
						</ComboBoxItem>
					)}
				</ComboBoxContent>
			</ComboBox>
			<ComboBox className="w-64" defaultSelectedKey="design">
				<Label>Selected</Label>
				<ComboBoxInput placeholder="Search channels" />
				<ComboBoxContent items={channels}>
					{(channel) => (
						<ComboBoxItem id={channel.id} textValue={channel.name}>
							{channel.name}
						</ComboBoxItem>
					)}
				</ComboBoxContent>
			</ComboBox>
		</GallerySection>
	)
}
