import { IconStar } from "~/components/icons/icon-star"
import { Toggle } from "~/components/ui/toggle"
import { GallerySection } from "../frame"

export const title = "Toggle"

const sizes = ["xs", "sm", "md", "lg"] as const
const squareSizes = ["sq-xs", "sq-sm", "sq-md", "sq-lg"] as const

export function Gallery() {
	return (
		<>
			<GallerySection title="Intents">
				<Toggle intent="plain">Plain</Toggle>
				<Toggle intent="outline">Outline</Toggle>
				<Toggle intent="plain" defaultSelected>
					Plain selected
				</Toggle>
				<Toggle intent="outline" defaultSelected>
					Outline selected
				</Toggle>
			</GallerySection>
			<GallerySection title="Sizes">
				{sizes.map((size) => (
					<Toggle key={size} intent="outline" size={size}>
						{`Size ${size}`}
					</Toggle>
				))}
			</GallerySection>
			<GallerySection title="Square sizes">
				{squareSizes.map((size) => (
					<Toggle key={size} intent="outline" size={size} aria-label={`Star ${size}`}>
						<IconStar />
					</Toggle>
				))}
			</GallerySection>
			<GallerySection title="Circle and icon">
				<Toggle intent="outline" isCircle>
					Circle
				</Toggle>
				<Toggle intent="outline" defaultSelected>
					<IconStar />
					Starred
				</Toggle>
			</GallerySection>
			<GallerySection title="Disabled">
				<Toggle intent="outline" isDisabled>
					Disabled
				</Toggle>
				<Toggle intent="outline" isDisabled defaultSelected>
					Disabled selected
				</Toggle>
			</GallerySection>
		</>
	)
}
