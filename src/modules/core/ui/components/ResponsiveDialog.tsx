/**
 * ResponsiveDialog
 *
 * Compound component that renders a Dialog on desktop and a Drawer (bottom sheet)
 * on mobile. All sub-components (Header, Title, Description, Footer, Body) are
 * context-aware and automatically switch between their Dialog / Drawer counterparts.
 *
 * Usage:
 *   <ResponsiveDialog open={open} onOpenChange={setOpen} dialogClassName="max-w-md">
 *     <ResponsiveDialog.Header>
 *       <ResponsiveDialog.Title>My Title</ResponsiveDialog.Title>
 *       <ResponsiveDialog.Description>Optional description</ResponsiveDialog.Description>
 *     </ResponsiveDialog.Header>
 *     <ResponsiveDialog.Body>…content…</ResponsiveDialog.Body>
 *     <ResponsiveDialog.Footer>…buttons…</ResponsiveDialog.Footer>
 *   </ResponsiveDialog>
 */

import React, { createContext, useContext } from 'react';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/modules/core/ui/primitives/drawer';
import { cn } from '@/modules/core/lib/utils';

// ── Context ────────────────────────────────────────────────────────────────────

interface ResponsiveDialogContextValue {
  isMobile: boolean;
}

const ResponsiveDialogContext = createContext<ResponsiveDialogContextValue>({
  isMobile: false,
});

function useResponsiveDialog() {
  return useContext(ResponsiveDialogContext);
}

// ── Root ───────────────────────────────────────────────────────────────────────

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /** Extra class names applied to DialogContent (desktop only) */
  dialogClassName?: string;
  /** Extra class names applied to DrawerContent (mobile only) */
  drawerClassName?: string;
}

function ResponsiveDialogRoot({
  open,
  onOpenChange,
  children,
  dialogClassName,
  drawerClassName,
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile();

  return (
    <ResponsiveDialogContext.Provider value={{ isMobile }}>
      {isMobile ? (
        <Drawer open={open} onOpenChange={onOpenChange}>
          <DrawerContent className={cn('bg-background border-border', drawerClassName)}>
            {children}
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className={dialogClassName}>
            {children}
          </DialogContent>
        </Dialog>
      )}
    </ResponsiveDialogContext.Provider>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ResponsiveDialogHeader({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  const { isMobile } = useResponsiveDialog();
  return isMobile ? (
    <DrawerHeader className={className}>{children}</DrawerHeader>
  ) : (
    <DialogHeader className={className}>{children}</DialogHeader>
  );
}

interface TitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children: React.ReactNode;
}

function ResponsiveDialogTitle({ className, children, ...props }: TitleProps) {
  const { isMobile } = useResponsiveDialog();
  return isMobile ? (
    <DrawerTitle className={className} {...(props as any)}>{children}</DrawerTitle>
  ) : (
    <DialogTitle className={className} {...(props as any)}>{children}</DialogTitle>
  );
}

interface DescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  children: React.ReactNode;
}

function ResponsiveDialogDescription({ className, children, ...props }: DescriptionProps) {
  const { isMobile } = useResponsiveDialog();
  return isMobile ? (
    <DrawerDescription className={className} {...(props as any)}>{children}</DrawerDescription>
  ) : (
    <DialogDescription className={className} {...(props as any)}>{children}</DialogDescription>
  );
}

function ResponsiveDialogFooter({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  const { isMobile } = useResponsiveDialog();
  return isMobile ? (
    <DrawerFooter className={cn('pb-6', className)}>{children}</DrawerFooter>
  ) : (
    <DialogFooter className={className}>{children}</DialogFooter>
  );
}

/** Generic scrollable body area — no Dialog/Drawer primitive equivalent, just a div */
function ResponsiveDialogBody({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4', className)}>{children}</div>;
}

// ── Compound export ────────────────────────────────────────────────────────────

const ResponsiveDialog = Object.assign(ResponsiveDialogRoot, {
  Header: ResponsiveDialogHeader,
  Title: ResponsiveDialogTitle,
  Description: ResponsiveDialogDescription,
  Footer: ResponsiveDialogFooter,
  Body: ResponsiveDialogBody,
});

export { ResponsiveDialog, useResponsiveDialog };
export type { ResponsiveDialogProps };
