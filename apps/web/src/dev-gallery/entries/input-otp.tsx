import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "~/components/ui/input-otp"
import { GallerySection } from "../frame"

export const title = "Input OTP"

export function Gallery() {
	return (
		<>
			<GallerySection title="Six digits">
				<InputOTP maxLength={6} aria-label="Verification code">
					<InputOTPGroup>
						<InputOTPSlot index={0} />
						<InputOTPSlot index={1} />
						<InputOTPSlot index={2} />
					</InputOTPGroup>
					<InputOTPSeparator />
					<InputOTPGroup>
						<InputOTPSlot index={3} />
						<InputOTPSlot index={4} />
						<InputOTPSlot index={5} />
					</InputOTPGroup>
				</InputOTP>
			</GallerySection>
			<GallerySection title="Prefilled">
				<InputOTP maxLength={4} defaultValue="42" aria-label="PIN">
					<InputOTPGroup>
						<InputOTPSlot index={0} />
						<InputOTPSlot index={1} />
						<InputOTPSlot index={2} />
						<InputOTPSlot index={3} />
					</InputOTPGroup>
				</InputOTP>
			</GallerySection>
			<GallerySection title="Disabled">
				<InputOTP maxLength={4} defaultValue="1234" disabled aria-label="Disabled code">
					<InputOTPGroup>
						<InputOTPSlot index={0} />
						<InputOTPSlot index={1} />
						<InputOTPSlot index={2} />
						<InputOTPSlot index={3} />
					</InputOTPGroup>
				</InputOTP>
			</GallerySection>
		</>
	)
}
