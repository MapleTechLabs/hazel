import { IconPlus } from "~/components/icons/icon-plus"
import { Button } from "~/components/ui/button"
import { Loader } from "~/components/ui/loader"
import { GallerySection } from "../frame"

export const title = "Button"

const intents = ["primary", "secondary", "warning", "danger", "outline", "plain"] as const
const sizes = ["xs", "sm", "md", "lg"] as const
const squareSizes = ["sq-xs", "sq-sm", "sq-md", "sq-lg"] as const

export function Gallery() {
	return (
		<>
			<GallerySection title="Intents">
				{intents.map((intent) => (
					<Button key={intent} intent={intent}>
						{intent}
					</Button>
				))}
			</GallerySection>
			<GallerySection title="Sizes">
				{sizes.map((size) => (
					<Button key={size} size={size}>
						{`Size ${size}`}
					</Button>
				))}
			</GallerySection>
			<GallerySection title="Circle">
				<Button isCircle>Circle</Button>
				<Button isCircle intent="outline">
					Circle outline
				</Button>
			</GallerySection>
			<GallerySection title="Icons">
				{sizes.map((size) => (
					<Button key={size} size={size} intent="outline">
						<IconPlus />
						{`Add ${size}`}
					</Button>
				))}
				<Button intent="secondary">
					Trailing
					<IconPlus />
				</Button>
			</GallerySection>
			<GallerySection title="Square sizes">
				{squareSizes.map((size) => (
					<Button key={size} size={size} intent="outline" aria-label={`Add ${size}`}>
						<IconPlus />
					</Button>
				))}
				<Button size="sq-md" isCircle aria-label="Add circle">
					<IconPlus />
				</Button>
			</GallerySection>
			<GallerySection title="Disabled">
				{intents.map((intent) => (
					<Button key={intent} intent={intent} isDisabled>
						{`Disabled ${intent}`}
					</Button>
				))}
			</GallerySection>
			<GallerySection title="Pending">
				<Button isPending>
					<Loader />
					Saving
				</Button>
				<Button intent="outline" isPending>
					<Loader variant="ring" />
					Loading
				</Button>
			</GallerySection>
		</>
	)
}
