import { useEffect, useRef, type ReactNode } from "react";
import type { AdminPageElement } from "./shared.js";

export const DRAWER_CSS = `
.commerce-drawer-root { position: fixed; inset: 0; z-index: 60; }
.commerce-drawer-backdrop {
  position: absolute; inset: 0; border: 0; padding: 0; margin: 0; cursor: default;
  background: color-mix(in srgb, black 45%, transparent);
}
.commerce-drawer-backdrop:hover { background: color-mix(in srgb, black 45%, transparent); }
.commerce-drawer {
  position: absolute; top: 0; right: 0; height: 100%;
  width: min(600px, calc(100vw - 32px));
  display: flex; flex-direction: column;
  background: var(--commerce-surface, var(--color-kumo-base));
  border-left: 1px solid var(--commerce-line);
  box-shadow: -18px 0 48px rgba(0,0,0,.22);
  animation: commerce-drawer-in .18s ease-out;
}
.commerce-drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 16px 20px; border-bottom: 1px solid var(--commerce-line);
}
.commerce-drawer-header h2 { margin: 0; font-size: 17px; font-weight: 650; }
.commerce-drawer-close {
  min-width: 36px; min-height: 36px; width: 36px; padding: 0;
  border: 1px solid var(--commerce-line); border-radius: 9px;
  background: var(--commerce-surface-soft); color: inherit; font-size: 14px;
}
.commerce-drawer-body { overflow-y: auto; flex: 1; padding: 4px 20px 28px; }
@keyframes commerce-drawer-in { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .commerce-drawer { animation: none; } }
`;

export interface DrawerProps {
  title: string;
  ariaLabel?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({ title, ariaLabel, onClose, children }: DrawerProps): AdminPageElement {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="commerce-drawer-root">
      <button type="button" className="commerce-drawer-backdrop" aria-label="Close panel" onClick={onClose} />
      <aside className="commerce-drawer" role="dialog" aria-modal="true" aria-label={ariaLabel ?? title}>
        <header className="commerce-drawer-header">
          <h2>{title}</h2>
          <button ref={closeButtonRef} type="button" className="commerce-drawer-close" aria-label="Close" onClick={onClose}>✕</button>
        </header>
        <div className="commerce-drawer-body">{children}</div>
      </aside>
      <style dangerouslySetInnerHTML={{ __html: DRAWER_CSS }} />
    </div>
  );
}
