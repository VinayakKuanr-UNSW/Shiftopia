
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from '@/modules/core/lib/utils'

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:shadow-glow/20",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80 shadow-lg shadow-primary/20",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground border-white/10 hover:bg-white/5",
        success: "border-transparent bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border-emerald-500/20",
        warning: "border-transparent bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border-amber-500/20",
        info: "border-transparent bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border-blue-500/20",
        glass: "border-white/10 bg-white/5 text-white backdrop-blur-md hover:bg-white/10",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
