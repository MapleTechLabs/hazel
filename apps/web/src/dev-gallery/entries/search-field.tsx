import { Description, Label } from "~/components/ui/field"
import { SearchField, SearchInput } from "~/components/ui/search-field"
import { GallerySection } from "../frame"

export const title = "Search field"

export function Gallery() {
	return (
		<>
			<GallerySection title="Search fields">
				<div className="w-72">
					<SearchField aria-label="Search messages">
						<SearchInput placeholder="Search messages" />
					</SearchField>
				</div>
				<div className="w-72">
					<SearchField aria-label="Search channels" defaultValue="general">
						<SearchInput placeholder="Search channels" />
					</SearchField>
				</div>
				<div className="w-72">
					<SearchField aria-label="Search disabled" isDisabled defaultValue="Disabled">
						<SearchInput placeholder="Disabled" />
					</SearchField>
				</div>
			</GallerySection>
			<GallerySection title="With label">
				<div className="w-72">
					<SearchField>
						<Label>Members</Label>
						<SearchInput placeholder="Find a member" />
						<Description>Search by name or email.</Description>
					</SearchField>
				</div>
			</GallerySection>
		</>
	)
}
