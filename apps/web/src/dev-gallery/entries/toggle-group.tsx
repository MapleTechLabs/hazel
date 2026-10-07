import { IconStar } from "~/components/icons/icon-star"
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group"
import { GallerySection } from "../frame"

export const title = "Toggle group"

export function Gallery() {
	return (
		<>
			<GallerySection title="Single">
				<ToggleGroup aria-label="Alignment" defaultSelectedKeys={["center"]}>
					<ToggleGroupItem id="left">Left</ToggleGroupItem>
					<ToggleGroupItem id="center">Center</ToggleGroupItem>
					<ToggleGroupItem id="right">Right</ToggleGroupItem>
					<ToggleGroupItem id="justify" isDisabled>
						Justify
					</ToggleGroupItem>
				</ToggleGroup>
			</GallerySection>
			<GallerySection title="Multiple">
				<ToggleGroup
					aria-label="Formatting"
					selectionMode="multiple"
					defaultSelectedKeys={["bold", "italic"]}
				>
					<ToggleGroupItem id="bold">Bold</ToggleGroupItem>
					<ToggleGroupItem id="italic">Italic</ToggleGroupItem>
					<ToggleGroupItem id="underline">Underline</ToggleGroupItem>
				</ToggleGroup>
			</GallerySection>
			<GallerySection title="Vertical">
				<ToggleGroup aria-label="Density" orientation="vertical" defaultSelectedKeys={["compact"]}>
					<ToggleGroupItem id="compact">Compact</ToggleGroupItem>
					<ToggleGroupItem id="comfortable">Comfortable</ToggleGroupItem>
					<ToggleGroupItem id="spacious">Spacious</ToggleGroupItem>
				</ToggleGroup>
				<ToggleGroup
					aria-label="Layers"
					orientation="vertical"
					selectionMode="multiple"
					defaultSelectedKeys={["grid"]}
				>
					<ToggleGroupItem id="grid">Grid</ToggleGroupItem>
					<ToggleGroupItem id="guides">Guides</ToggleGroupItem>
					<ToggleGroupItem id="rulers">Rulers</ToggleGroupItem>
				</ToggleGroup>
			</GallerySection>
			<GallerySection title="Sizes and circle">
				<ToggleGroup aria-label="Small" size="sm" defaultSelectedKeys={["day"]}>
					<ToggleGroupItem id="day">Day</ToggleGroupItem>
					<ToggleGroupItem id="week">Week</ToggleGroupItem>
				</ToggleGroup>
				<ToggleGroup aria-label="Large" size="lg" isCircle defaultSelectedKeys={["month"]}>
					<ToggleGroupItem id="month">Month</ToggleGroupItem>
					<ToggleGroupItem id="year">Year</ToggleGroupItem>
				</ToggleGroup>
				<ToggleGroup aria-label="Favorites" size="sq-sm" selectionMode="multiple" isCircle>
					<ToggleGroupItem id="star" aria-label="Star">
						<IconStar />
					</ToggleGroupItem>
					<ToggleGroupItem id="star-two" aria-label="Star two">
						<IconStar />
					</ToggleGroupItem>
				</ToggleGroup>
			</GallerySection>
		</>
	)
}
