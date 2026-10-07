import { IconFolder } from "~/components/icons/icon-folder"
import { IconHashtag } from "~/components/icons/icon-hashtag"
import { Tree, TreeContent, TreeItem } from "~/components/ui/tree"
import { GallerySection } from "../frame"

export const title = "Tree"

export function Gallery() {
	return (
		<GallerySection title="Channels">
			<Tree aria-label="Channels" defaultExpandedKeys={["engineering"]} className="w-72">
				<TreeItem id="engineering" textValue="Engineering">
					<TreeContent>
						<IconFolder />
						Engineering
					</TreeContent>
					<TreeItem id="frontend" textValue="frontend">
						<TreeContent>
							<IconHashtag />
							frontend
						</TreeContent>
					</TreeItem>
					<TreeItem id="backend" textValue="backend">
						<TreeContent>
							<IconHashtag />
							backend
						</TreeContent>
					</TreeItem>
					<TreeItem id="archived" textValue="archived" isDisabled>
						<TreeContent>
							<IconHashtag />
							archived
						</TreeContent>
					</TreeItem>
				</TreeItem>
				<TreeItem id="design" textValue="Design">
					<TreeContent>
						<IconFolder />
						Design
					</TreeContent>
					<TreeItem id="research" textValue="research">
						<TreeContent>
							<IconHashtag />
							research
						</TreeContent>
					</TreeItem>
				</TreeItem>
				<TreeItem id="general" textValue="general">
					<TreeContent>
						<IconHashtag />
						general
					</TreeContent>
				</TreeItem>
			</Tree>
		</GallerySection>
	)
}
