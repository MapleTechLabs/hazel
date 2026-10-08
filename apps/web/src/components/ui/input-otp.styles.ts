/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const inputOtpStyles = {
	/** InputOTP's wrapper span. */
	wrapper: "relative block",
	input: "disabled:cursor-not-allowed",
	// `has-[input:disabled]`, not `has-disabled`: Chrome cannot narrow `:has(:not([data-rac]):disabled)`,
	// so that rule restyled the whole document on every DOM insertion (S4 heavy-dataset scroll).
	control: "flex items-center gap-2 has-[input:disabled]:opacity-50",
	group: "flex items-center",
	slot: "relative flex size-9 items-center justify-center border-input border-y border-r shadow-xs outline-none transition-all [--input-otp-radius:calc(var(--radius-lg)-1px)] first:rounded-l-(--input-otp-radius) first:border-l last:rounded-r-(--input-otp-radius) aria-invalid:border-danger data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:bg-primary-subtle/10 data-[active=true]:ring-3 data-[active=true]:ring-ring/20 data-[active=true]:aria-invalid:border-danger-subtle-fg/70 data-[active=true]:aria-invalid:ring-danger-subtle-fg/20 sm:text-sm/6 dark:data-[active=true]:aria-invalid:ring-danger-subtle-fg/70",
	caret: "pointer-events-none absolute inset-0 flex items-center justify-center",
	caretBar: "h-4 w-px animate-caret-blink bg-fg duration-1000",
	separatorIcon: "size-4",
} as const
