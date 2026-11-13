"use client"

import * as React from "react"
import { Eye, EyeOff } from "lucide-react"

import { cn } from "@/lib/utils"
import { useI18n } from "@/components/i18n/LocaleProvider"

const INPUT_CLASSES = [
  "border-input file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
  "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
  "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
]

/** A password field with an eye button that shows or hides what has been typed. */
export function PasswordInput({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  const { t } = useI18n()
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="relative w-full">
      <input
        {...props}
        type={visible ? "text" : "password"}
        data-slot="input"
        className={cn(INPUT_CLASSES, className, "pr-10")}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={props.disabled}
        aria-label={visible ? t("Hide password") : t("Show password")}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-gray-500 hover:text-black disabled:opacity-50"
      >
        {visible ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
    </div>
  )
}

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  if (type === "password") return <PasswordInput className={className} {...props} />

  return (
    <input
      type={type}
      data-slot="input"
      className={cn(INPUT_CLASSES, className)}
      {...props}
    />
  )
}

export { Input }
