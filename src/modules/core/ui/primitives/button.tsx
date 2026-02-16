
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from '@/modules/core/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-primary/40",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm hover:shadow-destructive/25",
        outline:
          "border border-white/10 bg-transparent hover:bg-white/5 hover:text-accent-foreground hover:border-white/20 hover:shadow-glow transition-all",
        secondary:
          "bg-white/5 backdrop-blur-sm border border-white/10 text-secondary-foreground hover:bg-white/10 hover:border-white/20 shadow-sm",
        ghost: "hover:bg-accent/10 hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        glass: "backdrop-blur-md bg-white/5 border border-white/10 hover:bg-white/10 text-foreground shadow-sm hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/30",
        gaming: "bg-gradient-to-r from-purple-600 to-blue-500 text-white shadow-lg hover:shadow-xl hover:-translate-y-0.5 hover:brightness-110",
        solid: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md",
        warning: "bg-amber-500 text-white hover:bg-amber-600 shadow-lg shadow-amber-500/20",
      },
      size: {
        default: "h-10 px-5 py-2.5",
        sm: "h-9 rounded-md px-4 text-xs",
        lg: "h-12 rounded-lg px-8 text-base",
        icon: "h-10 w-10",
        xs: "h-8 rounded px-3 text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
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
