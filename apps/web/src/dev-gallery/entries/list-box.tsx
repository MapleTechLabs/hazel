import {
	ListBox,
	ListBoxDescription,
	ListBoxItem,
	ListBoxLabel,
	ListBoxSection,
} from "~/components/ui/list-box"
import { GallerySection } from "../frame"

export const title = "ListBox"

export function Gallery() {
	return (
		<>
			<GallerySection title="Single selection">
				<ListBox
					aria-label="Theme"
					selectionMode="single"
					defaultSelectedKeys={["system"]}
					className="w-64"
				>
					<ListBoxItem id="light">Light</ListBoxItem>
					<ListBoxItem id="dark">Dark</ListBoxItem>
					<ListBoxItem id="system">System</ListBoxItem>
				</ListBox>
			</GallerySection>
			<GallerySection title="Multiple selection with descriptions">
				<ListBox
					aria-label="Notify me about"
					selectionMode="multiple"
					defaultSelectedKeys={["mentions", "replies"]}
					disabledKeys={["all"]}
					className="w-72"
				>
					<ListBoxItem id="mentions" textValue="Mentions">
						<ListBoxLabel>Mentions</ListBoxLabel>
						<ListBoxDescription>When someone @mentions you</ListBoxDescription>
					</ListBoxItem>
					<ListBoxItem id="replies" textValue="Replies">
						<ListBoxLabel>Replies</ListBoxLabel>
						<ListBoxDescription>Replies to your threads</ListBoxDescription>
					</ListBoxItem>
					<ListBoxItem id="reactions" textValue="Reactions">
						<ListBoxLabel>Reactions</ListBoxLabel>
						<ListBoxDescription>Emoji on your messages</ListBoxDescription>
					</ListBoxItem>
					<ListBoxItem id="all" textValue="All messages">
						<ListBoxLabel>All messages</ListBoxLabel>
						<ListBoxDescription>Every new message in the channel</ListBoxDescription>
					</ListBoxItem>
				</ListBox>
			</GallerySection>
			<GallerySection title="Sections">
				<ListBox aria-label="Jump to" selectionMode="single" className="w-64">
					<ListBoxSection title="Channels">
						<ListBoxItem id="general">general</ListBoxItem>
						<ListBoxItem id="design">design</ListBoxItem>
					</ListBoxSection>
					<ListBoxSection title="Direct messages">
						<ListBoxItem id="grace">Grace Hopper</ListBoxItem>
						<ListBoxItem id="alan">Alan Turing</ListBoxItem>
					</ListBoxSection>
				</ListBox>
			</GallerySection>
		</>
	)
}
