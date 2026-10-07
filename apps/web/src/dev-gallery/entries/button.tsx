import { Button } from "~/components/ui/button"
import { GallerySection } from "../frame"

export const title = "Button"

const intents = ["primary", "secondary", "warning", "danger", "outline", "plain"] as const
const sizes = ["xs", "sm", "md", "lg"] as const

export function Gallery() {
	return (
		<>
			<GallerySection title="Intents">
				{intents.map((intent) => (
					<Button key={intent} intent={intent}>
						{intent}
					</Button>
				))}
			</GallerySection>
			<GallerySection title="Sizes">
				{sizes.map((size) => (
					<Button key={size} size={size}>
						{`Size ${size}`}
					</Button>
				))}
			</GallerySection>
			<GallerySection title="Circle">
				<Button isCircle>Circle</Button>
				<Button isCircle intent="outline">
					Circle outline
				</Button>
			</GallerySection>
		</>
	)
}
