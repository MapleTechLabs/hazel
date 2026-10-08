import { Keyboard } from "~/components/ui/keyboard"
import { Code, Strong, Text } from "~/components/ui/text"
import { GallerySection } from "../frame"

export const title = "Text"

export function Gallery() {
	return (
		<>
			<GallerySection title="Text">
				<Text className="max-w-md">
					Messages are kept for <Strong>90 days</Strong> on the free plan. Run{" "}
					<Code>hazel export</Code> to download a copy before they expire.
				</Text>
			</GallerySection>
			<GallerySection title="Keyboard">
				<Keyboard>⌘K</Keyboard>
				<Keyboard className="text-fg">Ctrl Shift P</Keyboard>
			</GallerySection>
		</>
	)
}
