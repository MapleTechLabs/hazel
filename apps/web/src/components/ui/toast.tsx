import { useTheme } from "next-themes"
import { Toaster as ToasterPrimitive, type ToasterProps } from "sonner"
import { toastClassName, toasterClassName, toasterStyle } from "./toast.styles"

export function Toast(props: ToasterProps) {
	const { theme = "system" } = useTheme()
	return (
		<ToasterPrimitive
			theme={theme as ToasterProps["theme"]}
			className={toasterClassName}
			richColors
			toastOptions={{ className: toastClassName }}
			style={toasterStyle as React.CSSProperties}
			{...props}
		/>
	)
}
