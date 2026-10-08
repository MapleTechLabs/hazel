import { Button } from "~/components/ui/button"
import {
	Modal,
	ModalBody,
	ModalClose,
	ModalContent,
	ModalDescription,
	ModalFooter,
	ModalHeader,
	ModalTitle,
} from "~/components/ui/modal"
import { GallerySection } from "../frame"

export const title = "Dialog"

export function Gallery() {
	return (
		<>
			<GallerySection title="Dialog">
				<Modal>
					<Button intent="outline">Open dialog</Button>
					<ModalContent>
						<ModalHeader>
							<ModalTitle>Rename thread</ModalTitle>
							<ModalDescription>
								Give this thread a name everyone will recognise.
							</ModalDescription>
						</ModalHeader>
						<ModalBody>
							<p className="text-sm/6">
								Thread names show up in the sidebar and in search results. You can change the
								name again at any time.
							</p>
						</ModalBody>
						<ModalFooter>
							<ModalClose>Cancel</ModalClose>
							<Button>Save</Button>
						</ModalFooter>
					</ModalContent>
				</Modal>
			</GallerySection>
			<GallerySection title="Alert dialog">
				<Modal>
					<Button intent="danger">Delete channel</Button>
					<ModalContent role="alertdialog" size="md">
						<ModalHeader
							title="Delete channel?"
							description="Messages in this channel will be removed for everyone."
						/>
						<ModalFooter>
							<ModalClose>Cancel</ModalClose>
							<Button intent="danger">Delete</Button>
						</ModalFooter>
					</ModalContent>
				</Modal>
			</GallerySection>
		</>
	)
}
