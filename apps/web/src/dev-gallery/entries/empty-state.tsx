import { IconFolder } from "~/components/icons/icon-folder"
import { Button } from "~/components/ui/button"
import { EmptyState } from "~/components/ui/empty-state"
import { GallerySection } from "../frame"

export const title = "Empty state"

export function Gallery() {
	return (
		<>
			<GallerySection title="Full">
				<EmptyState
					icon={IconFolder}
					title="No channels yet"
					description="Create a channel to start talking with your team."
					action={<Button size="sm">Create channel</Button>}
				/>
			</GallerySection>
			<GallerySection title="Title only">
				<EmptyState title="Nothing here" />
			</GallerySection>
			<GallerySection title="Long description">
				<EmptyState
					icon={IconFolder}
					title="No results match your filters"
					description="Try removing some filters or searching with different keywords. Results include messages, files and channels from every workspace you belong to."
					className="py-8"
				/>
			</GallerySection>
		</>
	)
}
