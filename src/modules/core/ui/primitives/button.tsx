
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from '@/modules/core/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-[13px] font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-muted shadow-none",
        secondary:
          "border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-sm",
        ghost: "hover:bg-accent/10 hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        glass: "border border-border bg-muted/50 text-foreground hover:bg-muted shadow-sm",
        gaming: "bg-gradient-to-r from-purple-600 to-blue-500 text-white shadow-sm hover:brightness-110",
        solid: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
        warning: "bg-amber-500 text-white hover:bg-amber-600 shadow-sm",
      },
      size: {
        // 44px on touch, 36px from md (pointer) — root font is 75%, so never h-10 (30px).
        default: "h-[44px] md:h-[36px] px-4",
        sm: "h-[40px] md:h-[32px] rounded-md px-3",
        lg: "h-[48px] rounded-lg px-6 text-[15px]",
        icon: "h-[44px] w-[44px] md:h-[36px] md:w-[36px]",
        xs: "h-[32px] rounded px-2.5 text-[11px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
