import { Link } from "~/components/ui/link"
import { GallerySection } from "../frame"

export const title = "Link"

export function Gallery() {
	return (
		<>
			<GallerySection title="With href">
				<Link href="/dev/gallery/link#docs">Documentation</Link>
				<Link href="/dev/gallery/link#primary" className="text-primary">
					Primary text
				</Link>
				<Link href="/dev/gallery/link#underlined" className="underline underline-offset-4">
					Underlined
				</Link>
			</GallerySection>
			<GallerySection title="Without href">
				<Link>Pressable text</Link>
			</GallerySection>
			<GallerySection title="Disabled">
				<Link href="/dev/gallery/link#disabled" isDisabled>
					Disabled with href
				</Link>
				<Link isDisabled>Disabled without href</Link>
			</GallerySection>
		</>
	)
}
