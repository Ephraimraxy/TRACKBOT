"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { T } from "@/components/i18n/T";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  /** Red confirm button, for actions that cannot be undone. */
  destructive?: boolean;
}

/**
 * A styled replacement for window.confirm (the grey browser box that says "<site> says").
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (!(await confirm({ message: "Remove this person?", destructive: true }))) return;
 *   ...
 *   return <>{...}{confirmDialog}</>;
 *
 * It resolves to true on the confirm button and to false on Cancel, Escape, the close
 * button or a click outside the box.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((answer: boolean) => void) | null>(null);

  const settle = useCallback((answer: boolean) => {
    resolver.current?.(answer);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback((o: ConfirmOptions | string) => {
    return new Promise<boolean>((resolve) => {
      resolver.current?.(false); // a second question cancels an unanswered first one
      resolver.current = resolve;
      setOptions(typeof o === "string" ? { message: o } : o);
    });
  }, []);

  const destructive = options?.destructive ?? false;

  const dialog = (
    <Dialog open={options !== null} onOpenChange={(open) => !open && settle(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                destructive ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-700"
              }`}
            >
              <AlertTriangle className="h-5 w-5" aria-hidden />
            </span>
            <DialogTitle>{options?.title ? <T>{options.title}</T> : <T>Please confirm</T>}</DialogTitle>
          </div>
          <DialogDescription className="pt-2 text-base text-gray-600">{options?.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            onClick={() => settle(false)}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-200"
          >
            <T>Cancel</T>
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => settle(true)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
              destructive ? "bg-red-600 hover:bg-red-700" : "bg-black hover:bg-gray-800"
            }`}
          >
            {options?.confirmLabel ? <T>{options.confirmLabel}</T> : <T>Confirm</T>}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return [confirm, dialog] as const;
}
