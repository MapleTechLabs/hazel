import { Button } from "~/components/ui/button"
import { Separator } from "~/components/ui/separator"
import { Toolbar } from "~/components/ui/toolbar"
import { GallerySection } from "../frame"

export const title = "Toolbar"

export function Gallery() {
	return (
		<>
			<GallerySection title="Horizontal">
				<Toolbar aria-label="Text formatting">
					<Button intent="plain" size="sm">
						Bold
					</Button>
					<Button intent="plain" size="sm">
						Italic
					</Button>
					<Separator orientation="vertical" className="mx-1 h-5" />
					<Button intent="plain" size="sm">
						Link
					</Button>
				</Toolbar>
			</GallerySection>
			<GallerySection title="Vertical">
				<Toolbar aria-label="Tools" orientation="vertical">
					<Button intent="outline" size="sm">
						Select
					</Button>
					<Button intent="outline" size="sm">
						Draw
					</Button>
				</Toolbar>
			</GallerySection>
		</>
	)
}
