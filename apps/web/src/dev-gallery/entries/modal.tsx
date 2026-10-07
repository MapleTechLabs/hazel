import { Button } from "~/components/ui/button"
import { Modal, ModalBody, ModalClose, ModalContent, ModalFooter, ModalHeader } from "~/components/ui/modal"
import { GallerySection } from "../frame"

export const title = "Modal"

const examples = [
	{ label: "Small", size: "sm" },
	{ label: "Extra large", size: "xl" },
	{ label: "Fullscreen", size: "fullscreen" },
] as const

export function Gallery() {
	return (
		<>
			<GallerySection title="Sizes">
				{examples.map((example) => (
					<Modal key={example.size}>
						<Button intent="outline">{example.label}</Button>
						<ModalContent size={example.size}>
							<ModalHeader
								title={`${example.label} modal`}
								description="Modals keep focus until they close."
							/>
							<ModalBody>
								<p className="text-sm/6">
									The panel width follows the size prop from sm upwards.
								</p>
							</ModalBody>
							<ModalFooter>
								<ModalClose>Close</ModalClose>
							</ModalFooter>
						</ModalContent>
					</Modal>
				))}
			</GallerySection>
			<GallerySection title="Options">
				<Modal>
					<Button intent="outline">Blurred</Button>
					<ModalContent isBlurred closeButton={false}>
						<ModalHeader title="Blurred backdrop" description="No close icon, blurred overlay." />
						<ModalFooter>
							<ModalClose>Done</ModalClose>
						</ModalFooter>
					</ModalContent>
				</Modal>
			</GallerySection>
		</>
	)
}
