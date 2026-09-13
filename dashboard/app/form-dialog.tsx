"use client";

import { useRef, type ReactNode } from "react";
import { Dialog } from "@radix-ui/themes";
import { X } from "lucide-react";

export function FormDialog({ open, onOpenChange, title, description, busy = false, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string;
  description: string; busy?: boolean; children: ReactNode;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <Dialog.Content className="mofu-dialog" maxWidth="640px"
      onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement; }}
      onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
      onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <div className="dialog-header">
        <div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description></div>
        <Dialog.Close><button type="button" className="modal-close" disabled={busy} aria-label="Close form"><X size={16} /></button></Dialog.Close>
      </div>
      <div className="dialog-body">{children}</div>
    </Dialog.Content>
  </Dialog.Root>;
}
