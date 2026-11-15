import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useApp } from "@/store/app"

/** shadcn `sonner`, themed from the app store (no next-themes). Toasts sit at z-40, under dialogs (z-50). */
function Toaster(props: ToasterProps) {
  const theme = useApp((s) => s.theme)
  return (
    <Sonner
      theme={theme}
      position="top-center"
      offset={{ top: 64, left: 12, right: 12 }}
      mobileOffset={{ top: 60, left: 12, right: 12 }}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast !rounded-2xl !border !border-border !bg-popover !text-popover-foreground !shadow-float !font-sans !text-sm",
          description: "!text-muted-foreground",
          actionButton: "!rounded-lg !bg-brand !px-3 !font-semibold !text-brand-foreground",
          cancelButton: "!rounded-lg !bg-muted !text-foreground",
        },
      }}
      style={{ zIndex: 40 }}
      {...props}
    />
  )
}

export { Toaster }
