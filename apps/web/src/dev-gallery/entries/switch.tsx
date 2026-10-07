import { Description, Label } from "~/components/ui/field"
import { Switch } from "~/components/ui/switch"
import { GallerySection } from "../frame"

export const title = "Switch"

export function Gallery() {
	return (
		<>
			<GallerySection title="States">
				<div className="w-64">
					<Switch>Off</Switch>
				</div>
				<div className="w-64">
					<Switch defaultSelected>On</Switch>
				</div>
				<div className="w-64">
					<Switch isDisabled>Disabled</Switch>
				</div>
				<div className="w-64">
					<Switch isDisabled defaultSelected>
						Disabled on
					</Switch>
				</div>
			</GallerySection>
			<GallerySection title="With description">
				<div className="w-80">
					<Switch>
						<Label elementType="span">Desktop notifications</Label>
						<Description>Show a banner for new messages.</Description>
					</Switch>
				</div>
			</GallerySection>
		</>
	)
}
