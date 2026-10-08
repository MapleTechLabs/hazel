import { IconRocket } from "~/components/icons/icon-rocket"
import { IconUser } from "~/components/icons/icon-user"
import { IconUsers } from "~/components/icons/icon-users"
import { ChoiceBox, ChoiceBoxDescription, ChoiceBoxItem, ChoiceBoxLabel } from "~/components/ui/choice-box"
import { GallerySection } from "../frame"

export const title = "Choice box"

export function Gallery() {
	return (
		<>
			<GallerySection title="Grid">
				<div className="w-[36rem]">
					<ChoiceBox
						gap={4}
						columns={2}
						layout="grid"
						aria-label="Team size"
						defaultSelectedKeys={["small"]}
					>
						<ChoiceBoxItem id="solo" textValue="Just me">
							<IconUser />
							<ChoiceBoxLabel>Just me</ChoiceBoxLabel>
							<ChoiceBoxDescription>Personal workspace</ChoiceBoxDescription>
						</ChoiceBoxItem>
						<ChoiceBoxItem id="small" textValue="2-10">
							<IconUsers />
							<ChoiceBoxLabel>2-10</ChoiceBoxLabel>
							<ChoiceBoxDescription>Small team</ChoiceBoxDescription>
						</ChoiceBoxItem>
						<ChoiceBoxItem id="large" textValue="11+">
							<IconRocket />
							<ChoiceBoxLabel>11+</ChoiceBoxLabel>
							<ChoiceBoxDescription>Growing company</ChoiceBoxDescription>
						</ChoiceBoxItem>
					</ChoiceBox>
				</div>
			</GallerySection>
			<GallerySection title="Stack">
				<div className="w-96">
					<ChoiceBox aria-label="Plan" defaultSelectedKeys={["pro"]} disabledKeys={["enterprise"]}>
						<ChoiceBoxItem id="free" label="Free" description="For trying things out" />
						<ChoiceBoxItem id="pro" label="Pro" description="For growing teams" />
						<ChoiceBoxItem id="enterprise" label="Enterprise" description="Talk to sales" />
					</ChoiceBox>
				</div>
			</GallerySection>
			<GallerySection title="Multiple">
				<div className="w-96">
					<ChoiceBox
						aria-label="Channels"
						selectionMode="multiple"
						defaultSelectedKeys={["general"]}
					>
						<ChoiceBoxItem id="general" label="General" description="Company-wide updates" />
						<ChoiceBoxItem id="random" label="Random" description="Everything else" />
					</ChoiceBox>
				</div>
			</GallerySection>
		</>
	)
}
