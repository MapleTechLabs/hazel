import { Button } from "~/components/ui/button"
import { SectionFooter } from "~/components/ui/section-footer"
import { SectionHeader } from "~/components/ui/section-header"
import { SectionLabel } from "~/components/ui/section-label"
import { GallerySection } from "../frame"

export const title = "Section header"

export function Gallery() {
	return (
		<>
			<GallerySection title="Header">
				<div className="w-[36rem]">
					<SectionHeader.Root>
						<SectionHeader.Group>
							<div className="flex flex-1 flex-col gap-1">
								<SectionHeader.Heading>Members</SectionHeader.Heading>
								<SectionHeader.Subheading>
									Manage who has access to this workspace.
								</SectionHeader.Subheading>
							</div>
							<SectionHeader.Actions>
								<Button intent="outline" size="sm">
									Export
								</Button>
								<Button size="sm">Invite</Button>
							</SectionHeader.Actions>
						</SectionHeader.Group>
					</SectionHeader.Root>
				</div>
				<SectionHeader.Heading size="xl">Extra large heading</SectionHeader.Heading>
			</GallerySection>
			<GallerySection title="Label">
				<SectionLabel.Root title="Display name" description="Shown to everyone." />
				<SectionLabel.Root title="Email" size="md" isRequired description="Used for sign in.">
					<SectionLabel.Actions>
						<Button size="xs">Verify</Button>
					</SectionLabel.Actions>
				</SectionLabel.Root>
			</GallerySection>
			<GallerySection title="Footer">
				<div className="flex w-[36rem] flex-col gap-6">
					<SectionFooter.Root>
						<span className="text-muted-fg text-sm">Changes are saved per workspace.</span>
						<SectionFooter.Actions>
							<Button intent="outline" size="sm">
								Cancel
							</Button>
							<Button size="sm">Save</Button>
						</SectionFooter.Actions>
					</SectionFooter.Root>
					<SectionFooter.Root isCard>
						<SectionFooter.Actions>
							<Button size="sm">Save card</Button>
						</SectionFooter.Actions>
					</SectionFooter.Root>
				</div>
			</GallerySection>
		</>
	)
}
