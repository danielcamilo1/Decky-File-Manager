import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t, loadRemoteTranslations, getLocale } from "./i18n";
import pluginInfo from "../plugin.json";
import packageInfo from "../package.json";
import {
  ButtonItem,
  Focusable,
  Navigation,
  NavEntryPositionPreferences,
  PanelSection,
  PanelSectionRow,
  Router,
  TextField,
  ToggleField,
  DropdownItem,
  ModalRoot,
  DialogBody,
  DialogButton,
} from "@decky/ui";
import { callable, definePlugin, routerHook } from "@decky/api";
import { showContextMenu, Menu, MenuGroup, MenuItem, MenuSeparator } from "@decky/ui";

const FOCUSABLE_SELECTOR = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1']):not([disabled])";

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") return false;
    if (element.closest("[inert]")) return false;
    if (element.hasAttribute("disabled")) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  });
}

function isTextInputElement(element: HTMLElement | null): boolean {
  return !!element && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement);
}

function ModalFocusScope({ children }: { children: ReactNode }) {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const scope = scopeRef.current;
    if (!scope) return;

    const fileManagerScope = document.querySelector<HTMLElement>("[data-file-manager-scope]");
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (fileManagerScope) {
      fileManagerScope.setAttribute("data-focus-scope-disabled", "true");
      fileManagerScope.setAttribute("aria-hidden", "true");
      fileManagerScope.setAttribute("inert", "");
      fileManagerScope.style.pointerEvents = "none";
    }

    const restoreFocus = () => {
      const previous = previousFocusRef.current;
      if (previous && document.contains(previous)) {
        try {
          previous.focus();
        } catch {
        }
        return;
      }

      const fallback = getFocusableElements(fileManagerScope)[0];
      if (fallback) {
        try {
          fallback.focus();
        } catch {
        }
      }
    };

    const trapFocus = (event: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (!scope.contains(activeElement)) {
        const focusables = getFocusableElements(scope);
        if (focusables.length > 0) {
          event.preventDefault();
          focusables[0].focus();
        }
        return;
      }

      if (event.key === "Tab") {
        const focusables = getFocusableElements(scope);
        if (focusables.length === 0) {
          event.preventDefault();
          scope.focus();
          return;
        }

        const currentIndex = focusables.indexOf(activeElement as HTMLElement);
        const nextIndex = event.shiftKey
          ? (currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1)
          : (currentIndex === -1 || currentIndex === focusables.length - 1 ? 0 : currentIndex + 1);
        event.preventDefault();
        focusables[nextIndex].focus();
        return;
      }

      if (!isTextInputElement(activeElement) && (event.key === "ArrowDown" || event.key === "ArrowRight")) {
        const focusables = getFocusableElements(scope);
        if (focusables.length > 0) {
          const currentIndex = focusables.indexOf(activeElement as HTMLElement);
          const nextIndex = currentIndex === -1 || currentIndex === focusables.length - 1 ? 0 : currentIndex + 1;
          event.preventDefault();
          focusables[nextIndex].focus();
        }
        return;
      }

      if (!isTextInputElement(activeElement) && (event.key === "ArrowUp" || event.key === "ArrowLeft")) {
        const focusables = getFocusableElements(scope);
        if (focusables.length > 0) {
          const currentIndex = focusables.indexOf(activeElement as HTMLElement);
          const nextIndex = currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1;
          event.preventDefault();
          focusables[nextIndex].focus();
        }
      }
    };

    const keepFocusInside = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (scope.contains(target)) return;
      event.stopPropagation();
      const focusables = getFocusableElements(scope);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        scope.focus();
      }
    };

    const focusables = getFocusableElements(scope);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      scope.focus();
    }

    document.addEventListener("keydown", trapFocus, true);
    document.addEventListener("focusin", keepFocusInside, true);

    return () => {
      document.removeEventListener("keydown", trapFocus, true);
      document.removeEventListener("focusin", keepFocusInside, true);

      if (fileManagerScope) {
        fileManagerScope.removeAttribute("data-focus-scope-disabled");
        fileManagerScope.removeAttribute("aria-hidden");
        fileManagerScope.removeAttribute("inert");
        fileManagerScope.style.pointerEvents = "";
      }

      restoreFocus();
    };
  }, []);

  return (
    <div ref={scopeRef} data-modal-focus-scope role="dialog" aria-modal="true" tabIndex={-1} style={{ outline: "none" }}>
      {children}
    </div>
  );
}

function BaseIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      {children}
    </svg>
  );
}

function FolderIcon() {
  return (
    <BaseIcon>
      <path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 9h-15a4.483 4.483 0 0 0-3 1.146Z" />
    </BaseIcon>
  );
}

function DocumentIcon() {
  return (
    <BaseIcon>
      <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z" />
      <path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z" />
    </BaseIcon>
  );
}

function ArchiveIcon() {
  return (
    <BaseIcon>
      <path d="M3.375 3C2.339 3 1.5 3.84 1.5 4.875v.75c0 1.036.84 1.875 1.875 1.875h17.25c1.035 0 1.875-.84 1.875-1.875v-.75C22.5 3.839 21.66 3 20.625 3H3.375Z" />
      <path fillRule="evenodd" d="m3.087 9 .54 9.176A3 3 0 0 0 6.62 21h10.757a3 3 0 0 0 2.995-2.824L20.913 9H3.087Zm6.163 3.75A.75.75 0 0 1 10 12h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
    </BaseIcon>
  );
}

function ExtractIcon() {
  return (
    <BaseIcon>
      <path d="M11.47 1.72a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1-1.06 1.06l-1.72-1.72V7.5h-1.5V4.06L9.53 5.78a.75.75 0 0 1-1.06-1.06l3-3ZM11.25 7.5V15a.75.75 0 0 0 1.5 0V7.5h3.75a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3h3.75Z" />
    </BaseIcon>
  );
}


function CopyIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M17.663 3.118c.225.015.45.032.673.05C19.876 3.298 21 4.604 21 6.109v9.642a3 3 0 0 1-3 3V16.5c0-5.922-4.576-10.775-10.384-11.217.324-1.132 1.3-2.01 2.548-2.114.224-.019.448-.036.673-.051A3 3 0 0 1 13.5 1.5H15a3 3 0 0 1 2.663 1.618ZM12 4.5A1.5 1.5 0 0 1 13.5 3H15a1.5 1.5 0 0 1 1.5 1.5H12Z" clipRule="evenodd" />
      <path d="M3 8.625c0-1.036.84-1.875 1.875-1.875h.375A3.75 3.75 0 0 1 9 10.5v1.875c0 1.036.84 1.875 1.875 1.875h1.875A3.75 3.75 0 0 1 16.5 18v2.625c0 1.035-.84 1.875-1.875 1.875h-9.75A1.875 1.875 0 0 1 3 20.625v-12Z" />
      <path d="M10.5 10.5a5.23 5.23 0 0 0-1.279-3.434 9.768 9.768 0 0 1 6.963 6.963 5.23 5.23 0 0 0-3.434-1.279h-1.875a.375.375 0 0 1-.375-.375V10.5Z" />
    </BaseIcon>
  );
}

function CutIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M8.128 9.155a3.751 3.751 0 1 1 .713-1.321l1.136.656a.75.75 0 0 1 .222 1.104l-.006.007a.75.75 0 0 1-1.032.157 1.421 1.421 0 0 0-.113-.072l-.92-.531Zm-4.827-3.53a2.25 2.25 0 0 1 3.994 2.063.756.756 0 0 0-.122.23 2.25 2.25 0 0 1-3.872-2.293ZM13.348 8.272a5.073 5.073 0 0 0-3.428 3.57 5.08 5.08 0 0 0-.165 1.202 1.415 1.415 0 0 1-.707 1.201l-.96.554a3.751 3.751 0 1 0 .734 1.309l13.729-7.926a.75.75 0 0 0-.181-1.374l-.803-.215a5.25 5.25 0 0 0-2.894.05l-5.325 1.629Zm-9.223 7.03a2.25 2.25 0 1 0 2.25 3.897 2.25 2.25 0 0 0-2.25-3.897ZM12 12.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
      <path d="M16.372 12.615a.75.75 0 0 1 .75 0l5.43 3.135a.75.75 0 0 1-.182 1.374l-.802.215a5.25 5.25 0 0 1-2.894-.051l-5.147-1.574a.75.75 0 0 1-.156-1.367l3-1.732Z" />
    </BaseIcon>
  );
}

function PasteIcon() {
  return (
    <BaseIcon>
      <path d="M10.5 3A1.501 1.501 0 0 0 9 4.5h6A1.5 1.5 0 0 0 13.5 3h-3Zm-2.693.178A3 3 0 0 1 10.5 1.5h3a3 3 0 0 1 2.694 1.678c.497.042.992.092 1.486.15 1.497.173 2.57 1.46 2.57 2.929V19.5a3 3 0 0 1-3 3H6.75a3 3 0 0 1-3-3V6.257c0-1.47 1.073-2.756 2.57-2.93.493-.057.989-.107 1.487-.15Z" />
    </BaseIcon>
  );
}

function NewFolderIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M19.5 21a3 3 0 0 0 3-3V9a3 3 0 0 0-3-3h-5.379a.75.75 0 0 1-.53-.22L11.47 3.66A2.25 2.25 0 0 0 9.879 3H4.5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h15Zm-6.75-10.5a.75.75 0 0 0-1.5 0v2.25H9a.75.75 0 0 0 0 1.5h2.25v2.25a.75.75 0 0 0 1.5 0v-2.25H15a.75.75 0 0 0 0-1.5h-2.25V10.5Z" clipRule="evenodd" />
    </BaseIcon>
  );
}

function RenameIcon() {
  return (
    <BaseIcon>
      <path d="M21.731 2.269a2.625 2.625 0 0 0-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 0 0 0-3.712ZM19.513 8.199l-3.712-3.712-8.4 8.4a5.25 5.25 0 0 0-1.32 2.214l-.8 2.685a.75.75 0 0 0 .933.933l2.685-.8a5.25 5.25 0 0 0 2.214-1.32l8.4-8.4Z" />
      <path d="M5.25 5.25a3 3 0 0 0-3 3v10.5a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3V13.5a.75.75 0 0 0-1.5 0v5.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V8.25a1.5 1.5 0 0 1 1.5-1.5h5.25a.75.75 0 0 0 0-1.5H5.25Z" />
    </BaseIcon>
  );
}

function EditIcon() {
  return (
    <BaseIcon>
      <path d="M21.731 2.269a2.625 2.625 0 0 0-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 0 0 0-3.712ZM19.513 8.199l-3.712-3.712-8.4 8.4a5.25 5.25 0 0 0-1.32 2.214l-.8 2.685a.75.75 0 0 0 .933.933l2.685-.8a5.25 5.25 0 0 0 2.214-1.32l8.4-8.4Z" />
      <path fillRule="evenodd" d="M2.25 20.25a.75.75 0 0 1 .75-.75h18a.75.75 0 0 1 0 1.5H3a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
    </BaseIcon>
  );
}

function NewFileIcon() {
  return (
    <BaseIcon>
      <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625ZM12.75 12a.75.75 0 0 0-1.5 0v2.25H9a.75.75 0 0 0 0 1.5h2.25V18a.75.75 0 0 0 1.5 0v-2.25H15a.75.75 0 0 0 0-1.5h-2.25V12Z" />
      <path d="M14.25 5.25a5.23 5.23 0 0 0-1.279-3.434 9.768 9.768 0 0 1 6.963 6.963A5.23 5.23 0 0 0 16.5 7.5h-1.875a.375.375 0 0 1-.375-.375V5.25Z" />
    </BaseIcon>
  );
}

function DeleteIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z" clipRule="evenodd" />
    </BaseIcon>
  );
}

function PropertiesIcon() {
  return (
    <BaseIcon>
      <path d="M10.5 3A1.501 1.501 0 0 0 9 4.5h6A1.5 1.5 0 0 0 13.5 3h-3Zm-2.693.178A3 3 0 0 1 10.5 1.5h3a3 3 0 0 1 2.694 1.678c.497.042.992.092 1.486.15 1.497.173 2.57 1.46 2.57 2.929V19.5a3 3 0 0 1-3 3H6.75a3 3 0 0 1-3-3V6.257c0-1.47 1.073-2.756 2.57-2.93.493-.057.989-.107 1.487-.15Z" />
    </BaseIcon>
  );
}

function PluginIcon() {
  return (
    <BaseIcon>
      <path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 9h-15a4.483 4.483 0 0 0-3 1.146Z" />
    </BaseIcon>
  );
}

function SplitViewIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M3 4.5A1.5 1.5 0 0 1 4.5 3h15A1.5 1.5 0 0 1 21 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-15Zm8.25 1.5h-6v12h6V6Zm1.5 0v12h6V6h-6Z" clipRule="evenodd" />
    </BaseIcon>
  );
}

function HomeIcon() {
  return (
    <BaseIcon>
      <path d="M11.47 3.841a.75.75 0 0 1 1.06 0l8.69 8.69a.75.75 0 1 0 1.06-1.061l-8.689-8.69a2.25 2.25 0 0 0-3.182 0l-8.69 8.69a.75.75 0 1 0 1.061 1.06l8.69-8.689Z" />
      <path d="m12 5.432 8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75V21a.75.75 0 0 1-.75.75H5.625a1.875 1.875 0 0 1-1.875-1.875v-6.198a2.29 2.29 0 0 0 .091-.086L12 5.432Z" />
    </BaseIcon>
  );
}

function SdCardIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M6 2.25A2.25 2.25 0 0 0 3.75 4.5v15A2.25 2.25 0 0 0 6 21.75h12a2.25 2.25 0 0 0 2.25-2.25V8.31c0-.597-.237-1.169-.659-1.591l-4.06-4.06a2.25 2.25 0 0 0-1.591-.659H6Zm2.25 3.75a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.5 0V6.75a.75.75 0 0 1 .75-.75Zm3 0a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.5 0V6.75a.75.75 0 0 1 .75-.75Zm3 0a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.5 0V6.75a.75.75 0 0 1 .75-.75Z" clipRule="evenodd" />
    </BaseIcon>
  );
}

function UsbIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M11.25 1.5a.75.75 0 0 1 1.5 0v12.19l2.03-2.03a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06l1.41 1.41V1.5ZM5.25 15a2.25 2.25 0 0 0-2.25 2.25v3A2.25 2.25 0 0 0 5.25 22.5h13.5A2.25 2.25 0 0 0 21 20.25v-3A2.25 2.25 0 0 0 18.75 15h-2.379l-2.31 2.31a2.25 2.25 0 0 1-3.182 0L8.569 15H5.25Z" clipRule="evenodd" />
    </BaseIcon>
  );
}

function DriveIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M2.25 6.75A2.25 2.25 0 0 1 4.5 4.5h15a2.25 2.25 0 0 1 2.25 2.25v3.75H2.25V6.75Zm0 5.25v5.25A2.25 2.25 0 0 0 4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V12H2.25Zm3.75 3a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1-.75-.75Zm0-8.25a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 0 1.5h-3A.75.75 0 0 1 6 6.75Z" clipRule="evenodd" />
    </BaseIcon>
  );
}

function HistoryIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M12 2.25a9.75 9.75 0 1 0 9.75 9.75.75.75 0 0 0-1.5 0A8.25 8.25 0 1 1 12 3.75c2.3 0 4.36 1.02 5.76 2.63h-2.26a.75.75 0 0 0 0 1.5h3.9a.75.75 0 0 0 .75-.75v-3.9a.75.75 0 0 0-1.5 0v1.96A9.72 9.72 0 0 0 12 2.25Z" clipRule="evenodd" />
      <path d="M12.75 7.5a.75.75 0 0 0-1.5 0v5.06l3.22 1.86a.75.75 0 1 0 .75-1.3l-2.47-1.43V7.5Z" />
    </BaseIcon>
  );
}

function ExitIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M7.5 3.75A1.5 1.5 0 0 0 6 5.25v13.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5V15a.75.75 0 0 1 1.5 0v3.75a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3V5.25a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3V9A.75.75 0 0 1 15 9V5.25a1.5 1.5 0 0 0-1.5-1.5h-6Zm10.72 4.72a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1 0 1.06l-3 3a.75.75 0 1 1-1.06-1.06l1.72-1.72H9a.75.75 0 0 1 0-1.5h10.94l-1.72-1.72a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </BaseIcon>
  );
}

function RootIcon() {
  return (
    <BaseIcon>
      <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.5 1.66a8.28 8.28 0 0 0-2.02 3.34h-2.2a8.28 8.28 0 0 1 4.22-3.34Zm3 0a8.28 8.28 0 0 1 4.22 3.34h-2.2a8.28 8.28 0 0 0-2.02-3.34ZM12 3.9c.63.83 1.14 1.86 1.48 3.35h-2.96C10.86 5.76 11.37 4.73 12 3.9ZM3.9 12c0-.78.11-1.53.31-2.25h2.6a15.6 15.6 0 0 0 0 4.5h-2.6A8.2 8.2 0 0 1 3.9 12Zm4.4 0c0-.78.05-1.53.14-2.25h7.12c.09.72.14 1.47.14 2.25s-.05 1.53-.14 2.25H8.44A17.5 17.5 0 0 1 8.3 12Zm8.89-2.25h2.6a8.28 8.28 0 0 1 0 4.5h-2.6a15.6 15.6 0 0 0 0-4.5ZM12 20.1c-.63-.83-1.14-1.86-1.48-3.35h2.96c-.34 1.49-.85 2.52-1.48 3.35Zm-1.5-.01a8.28 8.28 0 0 1-4.22-3.34h2.2a8.28 8.28 0 0 0 2.02 3.34Zm3 0a8.28 8.28 0 0 0 2.02-3.34h2.2a8.28 8.28 0 0 1-4.22 3.34Z" clipRule="evenodd" />
    </BaseIcon>
  );
}

type FileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  modified: number;
};

type RecentEntry = {
  name: string;
  path: string;
};

type DriveKind = "home" | "root" | "sdcard" | "usb" | "internal";

type DriveEntry = {
  name: string;
  path: string;
  kind: DriveKind;
  device: string | null;
  total: number | null;
  free: number | null;
};

function isArchiveFile(name: string): boolean {
  const lower = name.toLowerCase();
  const archiveExtensions = [
    ".zip",
    ".tar",
    ".tar.gz",
    ".tgz",
    ".tar.bz2",
    ".tar.xz",
    ".tar.zst",
    ".rar",
    ".7z",
    ".gz",
    ".bz2",
    ".xz",
    ".zst",
    ".iso",
  ];
  return archiveExtensions.some((ext) => lower.endsWith(ext));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(value < 10 && i > 0 ? 2 : 0)} ${sizes[i]}`;
}

function parentDirOf(path: string): string {
  const parts = path.split("/").filter((p) => p !== "");
  parts.pop();
  return parts.length === 0 ? "/" : "/" + parts.join("/");
}

function shortPath(path: string, segments = 2): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  if (parts.length <= segments) return "/" + parts.join("/");
  return "…/" + parts.slice(-segments).join("/");
}

function driveIconFor(kind: DriveKind) {
  if (kind === "home") return <HomeIcon />;
  if (kind === "root") return <RootIcon />;
  if (kind === "sdcard") return <SdCardIcon />;
  if (kind === "usb") return <UsbIcon />;
  return <DriveIcon />;
}

// An unlabelled volume falls back to its device node ("mmcblk0p1"), which is
// no use to anyone; show what kind of drive it is instead.
const RAW_DEVICE_NAME = /^(mmcblk\d|sd[a-z]\d?|nvme\d|loop\d|sr\d)/i;

function driveLabelFor(drive: DriveEntry): string {
  if (drive.kind === "home") return t("drive.home");
  if (drive.kind === "root") return t("drive.root");
  if (!drive.name || RAW_DEVICE_NAME.test(drive.name)) {
    if (drive.kind === "sdcard") return t("drive.sdcard");
    if (drive.kind === "usb") return t("drive.usb");
    return t("drive.internal");
  }
  return drive.name;
}

const listDir = callable<[string], { path: string; items: FileEntry[] }>("list_dir");
const listDrives = callable<[], { drives: DriveEntry[] }>("list_drives");
/**
 * Visited folders are tracked here rather than over RPC. The frontend already
 * knows every folder it opens, and keeping the list local means it cannot come
 * up empty because of anything on the backend side.
 */
const RECENT_STORAGE_KEY = "decky-file-manager:recent-paths";
const RECENT_LIMIT = 12;

function loadRecentPaths(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string" && entry) : [];
  } catch {
    return [];
  }
}

function saveRecentPaths(paths: string[]): void {
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // A full or unavailable store is not worth breaking navigation over.
  }
}

function recordRecentPath(path: string): string[] {
  const next = [path, ...loadRecentPaths().filter((entry) => entry !== path)].slice(0, RECENT_LIMIT);
  saveRecentPaths(next);
  return next;
}

/**
 * Steam's own submenu component, found by searching its bundle, so it can come
 * back undefined if Valve moves it. Rendering undefined would take the whole
 * menu down, so it is only used when it is there; the fallback opens a second
 * menu instead, which needs nothing but showContextMenu.
 */
const SubMenu = MenuGroup as unknown as React.FC<{ label: string; children?: React.ReactNode }> | undefined;

function recentEntriesFrom(paths: string[]): RecentEntry[] {
  return paths.map((entry) => ({
    path: entry,
    name: entry.split("/").filter(Boolean).pop() || entry,
  }));
}
const readTextFile = callable<[string], {
  path: string;
  name: string;
  content: string;
  encoding: string;
  size: number;
  modified: number;
  read_only: boolean;
}>("read_text_file");
const writeTextFile = callable<[string, string, number, string, boolean], {
  success: boolean;
  stale?: boolean;
  path: string;
  size?: number;
  modified: number;
  encoding?: string;
}>("write_text_file");

/**
 * Backend exception text is Portuguese by convention; match on it so the
 * reason a file was refused reads in the user's own language.
 */
function backendErrorMessage(e: any, fallbackKey: string): string {
  const message = String(e?.message ?? t(fallbackKey));
  const lower = message.toLowerCase();
  if (lower.includes("permissão")) return t("permission.denied");
  if (lower.includes("binário")) return t("editor.error_binary");
  if (lower.includes("grande demais")) return t("editor.error_too_large");
  return message;
}

type PaneIndex = 0 | 1;

type PaneApi = {
  index: PaneIndex;
  path: string;
  pathRef: React.MutableRefObject<string>;
  editedPath: string;
  setEditedPath: React.Dispatch<React.SetStateAction<string>>;
  items: FileEntry[];
  itemsRef: React.MutableRefObject<FileEntry[]>;
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  focusPathRef: React.MutableRefObject<string | null>;
  setFocusPath: (value: string | null) => void;
  loadPath: (newPath: string, notFoundMsg?: string, pushHistory?: boolean, focusTarget?: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  goUp: () => boolean;
};

/**
 * All of the per-panel browsing state. Two independent instances back the
 * split view; in single-panel mode only the active one is rendered.
 */
function usePane(index: PaneIndex, initialPath: string): PaneApi {
  const [path, setPathState] = useState(initialPath);
  const pathRef = useRef(initialPath);
  const [editedPath, setEditedPath] = useState(initialPath);
  const historyRef = useRef<Array<{ path: string; focusTarget: string | null }>>([]);
  const [items, setItems] = useState<FileEntry[]>([]);
  const itemsRef = useRef<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const focusPathRef = useRef<string | null>(null);

  const setFocusPath = useCallback((value: string | null) => {
    focusPathRef.current = value;
  }, []);

  const applyListing = useCallback(
    (res: { path: string; items: FileEntry[] }, focusTarget: string | null) => {
      setPathState(res.path);
      pathRef.current = res.path;
      setEditedPath(res.path);
      setItems(res.items);
      itemsRef.current = res.items;
      setFocusPath(focusTarget);
    },
    [setFocusPath],
  );

  const loadPath = useCallback(
    async (newPath: string, notFoundMsg?: string, pushHistory = true, focusTarget: string | null = null) => {
      setLoading(true);
      setError(null);
      try {
        const res = await listDir(newPath);
        if (pushHistory && res.path !== pathRef.current) {
          historyRef.current = [...historyRef.current, { path: pathRef.current, focusTarget }];
        }
        applyListing(res, focusTarget);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(notFoundMsg ?? message ?? t("error.could_not_load_directory"));
      } finally {
        setLoading(false);
      }
    },
    [applyListing],
  );

  const refresh = useCallback(async () => {
    const keepFocus = focusPathRef.current;
    try {
      const res = await listDir(pathRef.current);
      applyListing(res, keepFocus);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    }
  }, [applyListing]);

  const goUp = useCallback(() => {
    const current = pathRef.current;
    if (!current || current === "/") return false;

    const parent = parentDirOf(current);
    if (parent === current) return false;

    // Land back on the folder we just came out of, the way desktop file
    // managers do, so repeated B presses walk a predictable trail.
    void loadPath(parent, t("error.directory_not_found"), true, current);
    return true;
  }, [loadPath]);

  return {
    index,
    path,
    pathRef,
    editedPath,
    setEditedPath,
    items,
    itemsRef,
    loading,
    error,
    setError,
    focusPathRef,
    setFocusPath,
    loadPath,
    refresh,
    goUp,
  };
}

function DriveChip({ drive, current, onSelect }: { drive: DriveEntry; current: boolean; onSelect: (drive: DriveEntry) => void }) {
  const activate = useCallback(() => onSelect(drive), [drive, onSelect]);

  return (
    <Focusable
      onActivate={activate}
      onClick={activate}
      focusWithinClassName="gpfocuswithin"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 4,
        flexShrink: 0,
        cursor: "pointer",
        border: `1px solid ${current ? "rgba(120,180,255,0.9)" : "rgba(255,255,255,0.12)"}`,
        background: current ? "rgba(120,180,255,0.16)" : "rgba(255,255,255,0.05)",
      }}
    >
      {driveIconFor(drive.kind)}
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.2 }}>
        <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
          {driveLabelFor(drive)}
        </span>
        {drive.free !== null ? (
          <span style={{ fontSize: 10, opacity: 0.6, whiteSpace: "nowrap" }}>
            {t("drive.free").replace("{free}", formatBytes(drive.free))}
          </span>
        ) : null}
      </div>
    </Focusable>
  );
}

function DrivesBar({ drives, currentPath, onSelect }: { drives: DriveEntry[]; currentPath: string; onSelect: (drive: DriveEntry) => void }) {
  // Longest mount point that contains the current path wins the highlight, so
  // "/run/media/SD" beats "/" when browsing the card.
  const currentDrivePath = useMemo(() => {
    let best: string | null = null;
    for (const drive of drives) {
      const prefix = drive.path === "/" ? "/" : `${drive.path}/`;
      if (currentPath === drive.path || currentPath.startsWith(prefix)) {
        if (best === null || drive.path.length > best.length) best = drive.path;
      }
    }
    return best;
  }, [drives, currentPath]);

  if (!drives.length) return null;

  return (
    <div style={{ padding: "0 0 8px", minWidth: 0 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.6, opacity: 0.55, padding: "0 0 4px 2px" }}>{t("label.drives")}</div>
      <Focusable
        navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
        style={{ display: "flex", gap: 8, overflowX: "auto", overflowY: "hidden", padding: "2px 0 4px" }}
      >
        {drives.map((drive) => (
          <DriveChip key={drive.path} drive={drive} current={drive.path === currentDrivePath} onSelect={onSelect} />
        ))}
      </Focusable>
    </div>
  );
}

type PaneViewProps = {
  pane: PaneApi;
  dual: boolean;
  active: boolean;
  showHidden: boolean;
  sortOrder: string;
  fileTypeFilter: string;
  onPaneFocus: (index: PaneIndex) => void;
  onOpenDir: (pane: PaneApi, item: FileEntry) => void;
  registerContainer: (index: PaneIndex, element: HTMLDivElement | null) => void;
};

function PaneView({
  pane,
  dual,
  active,
  showHidden,
  sortOrder,
  fileTypeFilter,
  onPaneFocus,
  onOpenDir,
  registerContainer,
}: PaneViewProps) {
  const [visibleItemCount, setVisibleItemCount] = useState(150);

  useEffect(() => {
    setVisibleItemCount(150);
  }, [pane.path, showHidden, sortOrder, fileTypeFilter]);

  const filteredItems = useMemo(() => {
    let filtered = pane.items;

    if (!showHidden) {
      filtered = filtered.filter((item) => !item.name.startsWith("."));
    }

    if (fileTypeFilter === "folders") {
      filtered = filtered.filter((item) => item.is_dir);
    } else if (fileTypeFilter === "files") {
      filtered = filtered.filter((item) => !item.is_dir);
    }

    return [...filtered].sort((a, b) => {
      const comparison = a.name.localeCompare(b.name);
      return sortOrder === "asc" ? comparison : -comparison;
    });
  }, [pane.items, showHidden, fileTypeFilter, sortOrder]);

  const visibleItems = filteredItems.slice(0, visibleItemCount);
  const hasMoreItems = visibleItems.length < filteredItems.length;

  const rows = (() => {
    if (pane.loading) return <PanelSectionRow>{t("action.loading")}</PanelSectionRow>;
    if (pane.error) return <PanelSectionRow>{pane.error}</PanelSectionRow>;
    if (!filteredItems.length) return <PanelSectionRow>{t("panel.empty")}</PanelSectionRow>;

    return (
      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_Y}>
        {visibleItems.map((item) => (
          <div key={item.path} data-item-path={item.path} data-pane-index={pane.index}>
            <PanelSectionRow>
              <Focusable
                onActivate={() => onOpenDir(pane, item)}
                onFocus={() => {
                  pane.setFocusPath(item.path);
                  onPaneFocus(pane.index);
                }}
              >
                <ButtonItem onClick={() => onOpenDir(pane, item)} layout="below">
                  <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", textAlign: "left", alignItems: "center", gap: 10, minWidth: 0 }}>
                    {item.is_dir ? <FolderIcon /> : isArchiveFile(item.name) ? <ArchiveIcon /> : <DocumentIcon />}
                    <span
                      style={{
                        color: "currentColor",
                        opacity: 0.95,
                        fontSize: dual ? 13 : undefined,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                      }}
                    >
                      {item.name}
                    </span>
                  </div>
                </ButtonItem>
              </Focusable>
            </PanelSectionRow>
          </div>
        ))}
        {hasMoreItems ? (
          <PanelSectionRow>
            <ButtonItem onClick={() => setVisibleItemCount((count) => count + 150)}>
              {t("action.show_more").replace("{count}", String(filteredItems.length - visibleItems.length))}
            </ButtonItem>
          </PanelSectionRow>
        ) : null}
      </Focusable>
    );
  })();

  const highlighted = dual && active;

  return (
    <div
      ref={(element) => registerContainer(pane.index, element)}
      data-pane-root
      data-pane-index={pane.index}
      style={{
        flex: "1 1 0%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        borderRadius: 6,
        overflow: "hidden",
        border: `1px solid ${highlighted ? "rgba(120,180,255,0.85)" : "rgba(255,255,255,0.07)"}`,
        background: highlighted ? "rgba(120,180,255,0.05)" : "rgba(0,0,0,0.12)",
        boxShadow: highlighted ? "0 0 0 1px rgba(120,180,255,0.35)" : "none",
        transition: "border-color 0.12s linear, background 0.12s linear",
      }}
    >
      {dual ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            background: highlighted ? "rgba(120,180,255,0.12)" : "rgba(255,255,255,0.03)",
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.5,
              padding: "2px 6px",
              borderRadius: 3,
              flexShrink: 0,
              background: highlighted ? "rgba(120,180,255,0.9)" : "rgba(255,255,255,0.12)",
              color: highlighted ? "#0b1622" : "inherit",
            }}
          >
            {pane.index === 0 ? "L1" : "R1"}
          </span>
          <span
            title={pane.path}
            style={{ flex: 1, minWidth: 0, fontSize: 12, opacity: highlighted ? 1 : 0.65, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}
          >
            {shortPath(pane.path, 3)}
          </span>
          <span style={{ fontSize: 11, opacity: 0.5, flexShrink: 0 }}>{filteredItems.length}</span>
        </div>
      ) : null}

      <div
        onScroll={(event) => {
          const element = event.currentTarget;
          if (element.scrollTop + element.clientHeight >= element.scrollHeight - 160) {
            setVisibleItemCount((count) => Math.min(count + 150, filteredItems.length));
          }
        }}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 48, boxSizing: "border-box" }}
      >
        <PanelSection title={dual ? undefined : t("panel.files")}>{rows}</PanelSection>
        <div style={{ height: 48, flexShrink: 0 }} />
      </div>
    </div>
  );
}

/**
 * An on-screen keyboard built out of ordinary buttons.
 *
 * Steam's own keyboard is attached to its TextField and could not be made to
 * appear here, so rather than keep chasing it, this types without Steam's help
 * at all: every key is a DialogButton inside a Focusable, exactly like the file
 * list rows that the D-pad already drives. Nothing about it can fail for
 * reasons outside this file.
 */
const KEY_ROWS_LOWER = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "-"],
  ["z", "x", "c", "v", "b", "n", "m", ".", "/", "_"],
];

const KEY_ROWS_UPPER = [
  ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L", "+"],
  ["Z", "X", "C", "V", "B", "N", "M", ",", "?", "="],
];

const KEY_ROWS_SYMBOLS = [
  ["~", "`", "|", "\\", ":", ";", "\"", "'", "<", ">"],
  ["[", "]", "{", "}", "(", ")", "/", "?", "!", "*"],
  ["@", "#", "$", "%", "^", "&", "-", "_", "+", "="],
  [".", ",", "0", "1", "2", "3", "4", "5", "6", "7"],
];

function OnScreenKeyboard({
  onKey,
  onBackspace,
  onSpace,
  onEnter,
  onCaret,
  onLine,
  onDone,
}: {
  onKey: (character: string) => void;
  onBackspace: () => void;
  onSpace: () => void;
  onEnter: () => void;
  onCaret: (delta: number) => void;
  onLine: (delta: number) => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"lower" | "upper" | "symbols">("lower");
  const rows = mode === "lower" ? KEY_ROWS_LOWER : mode === "upper" ? KEY_ROWS_UPPER : KEY_ROWS_SYMBOLS;

  const keyStyle = {
    minWidth: 0,
    flex: "1 1 0%",
    padding: "5px 0",
    fontSize: 14,
    fontFamily: "Consolas, 'Courier New', monospace",
  } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 6 }}>
      {rows.map((row, rowIndex) => (
        <Focusable key={rowIndex} style={{ display: "flex", gap: 4 }}>
          {row.map((character, keyIndex) => (
            <DialogButton key={`${rowIndex}-${keyIndex}`} style={keyStyle} onClick={() => onKey(character)}>
              {character}
            </DialogButton>
          ))}
        </Focusable>
      ))}

      <Focusable style={{ display: "flex", gap: 4 }}>
        <DialogButton style={keyStyle} onClick={() => setMode(mode === "upper" ? "lower" : "upper")}>
          {mode === "upper" ? "abc" : "ABC"}
        </DialogButton>
        <DialogButton style={keyStyle} onClick={() => setMode(mode === "symbols" ? "lower" : "symbols")}>
          {mode === "symbols" ? "abc" : "#+="}
        </DialogButton>
        <DialogButton style={{ ...keyStyle, flex: "3 1 0%" }} onClick={onSpace}>{t("editor.space")}</DialogButton>
        <DialogButton style={keyStyle} onClick={onBackspace}>{"⌫"}</DialogButton>
        {/* Splits the line at the cursor, the way Enter does in any editor. */}
        <DialogButton style={keyStyle} onClick={onEnter}>{"↵"}</DialogButton>
      </Focusable>

      <Focusable style={{ display: "flex", gap: 4 }}>
        <DialogButton style={keyStyle} onClick={() => onCaret(-1)}>{"◀"}</DialogButton>
        <DialogButton style={keyStyle} onClick={() => onCaret(1)}>{"▶"}</DialogButton>
        {/* Commit this line and carry on typing the one above/below, without
            leaving the keyboard: the whole point of the redesign. */}
        <DialogButton style={keyStyle} onClick={() => onLine(-1)}>{"▲"}</DialogButton>
        <DialogButton style={keyStyle} onClick={() => onLine(1)}>{"▼"}</DialogButton>
        <DialogButton style={{ ...keyStyle, flex: "2 1 0%" }} onClick={onDone}>{t("editor.done")}</DialogButton>
      </Focusable>
    </div>
  );
}

type EditorBuffer = {
  path: string;
  name: string;
  content: string;
  original: string;
  encoding: string;
  modified: number;
  readOnly: boolean;
};

/**
 * The file editor, rendered inline on the page in place of the file list.
 *
 * Not a modal on purpose. A dialog only joins Steam's gamepad navigation
 * when its modal manager mounts it, and that could not be made to work here
 * — the editor was reachable by touch at best. The page itself is navigable,
 * so the editor lives there and uses the same components as the file list.
 *
 * It has two modes, like a console text editor:
 *
 * - Reading: the whole file as a list of lines. A on a line starts editing it.
 * - Typing: the lines around the one being edited stay on screen with a cursor
 *   drawn in place, and the keyboard sits underneath. The keyboard never
 *   disappears between lines — ▲/▼ commit the current line and move to the
 *   next, ↵ splits a line, ◀/▶ (and L1/R1) move the cursor — so a run of edits
 *   is one continuous session rather than one round trip per line.
 */
function EditorView({
  buffer,
  loading,
  saving,
  saved,
  error,
  stale,
  discardPrompt,
  editingLine,
  editingValue,
  editingCaret,
  visibleLines,
  onEditingText,
  onStartLine,
  onInsertText,
  onBackspace,
  onEnter,
  onCaret,
  onMoveLine,
  onApplyLine,
  onCancelLine,
  onClearLine,
  onInsertLine,
  onDeleteLine,
  onShowMore,
  onSave,
  onReload,
  onKeepEditing,
  onDiscard,
  onClose,
}: {
  buffer: EditorBuffer;
  loading: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
  stale: boolean;
  discardPrompt: boolean;
  editingLine: number | null;
  editingValue: string;
  editingCaret: number;
  visibleLines: number;
  onEditingText: (value: string, caret: number) => void;
  onStartLine: (index: number) => void;
  onInsertText: (text: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
  onCaret: (delta: number) => void;
  onMoveLine: (delta: number) => void;
  onApplyLine: () => void;
  onCancelLine: () => void;
  onClearLine: () => void;
  onInsertLine: (index: number) => void;
  onDeleteLine: (index: number) => void;
  onShowMore: () => void;
  onSave: (force: boolean) => void;
  onReload: () => void;
  onKeepEditing: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const lines = useMemo(() => buffer.content.split("\n"), [buffer.content]);
  const dirty = buffer.content !== buffer.original;
  const editing = editingLine !== null;

  const status = buffer.readOnly
    ? t("editor.read_only")
    : loading
      ? t("editor.loading")
      : dirty
        ? t("editor.unsaved")
        : saved
          ? t("editor.saved")
          : buffer.encoding;

  // The lines on either side of the one being typed, so the file stays legible
  // while editing instead of being replaced by a lone text field.
  const contextStart = editing ? Math.max(0, editingLine - 3) : 0;
  const contextEnd = editing ? Math.min(lines.length, editingLine + 4) : 0;
  const context: number[] = [];
  for (let index = contextStart; index < contextEnd; index += 1) context.push(index);

  const caret = Math.max(0, Math.min(editingCaret, editingValue.length));

  const gutterStyle = { opacity: 0.35, minWidth: 34, textAlign: "right", flexShrink: 0 } as const;
  const monospace = { fontFamily: "Consolas, 'Courier New', monospace", fontSize: 13 } as const;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "2px 0 8px", minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 20, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{buffer.name}</h1>
        <span style={{ fontSize: 12, opacity: 0.55, flexShrink: 0 }}>{status}</span>
        <span style={{ fontSize: 12, opacity: 0.4, flexShrink: 0, marginLeft: "auto" }}>
          {editing
            ? t("editor.position").replace("{line}", String(editingLine + 1)).replace("{column}", String(caret + 1))
            : t("editor.lines").replace("{count}", String(lines.length))}
        </span>
      </div>

      {error ? (
        <div style={{ margin: "0 0 8px", padding: "6px 10px", borderRadius: 4, fontSize: 12, background: "rgba(220,80,80,0.15)", border: "1px solid rgba(220,80,80,0.4)" }}>
          {error}
        </div>
      ) : null}

      {stale ? (
        <div style={{ margin: "0 0 8px", padding: "8px 10px", borderRadius: 4, fontSize: 12, background: "rgba(230,170,60,0.15)", border: "1px solid rgba(230,170,60,0.45)" }}>
          <div style={{ marginBottom: 8 }}>{t("editor.stale_message").replace("{name}", buffer.name)}</div>
          <Focusable style={{ display: "flex", gap: 8 }}>
            <DialogButton style={{ flex: 1 }} onClick={() => onSave(true)}>{t("editor.overwrite")}</DialogButton>
            <DialogButton style={{ flex: 1 }} onClick={onReload}>{t("editor.reload")}</DialogButton>
          </Focusable>
        </div>
      ) : null}

      {discardPrompt ? (
        <div style={{ margin: "0 0 8px", padding: "8px 10px", borderRadius: 4, fontSize: 12, background: "rgba(220,80,80,0.12)", border: "1px solid rgba(220,80,80,0.4)" }}>
          <div style={{ marginBottom: 8 }}>{t("editor.discard_message").replace("{name}", buffer.name)}</div>
          <Focusable style={{ display: "flex", gap: 8 }}>
            <DialogButton style={{ flex: 1 }} onClick={onKeepEditing}>{t("editor.keep_editing")}</DialogButton>
            <DialogButton style={{ flex: 1 }} onClick={onDiscard}>{t("editor.discard")}</DialogButton>
          </Focusable>
        </div>
      ) : null}

      {editing ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div
            style={{
              ...monospace,
              padding: "6px 4px",
              marginBottom: 6,
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(0,0,0,0.3)",
              overflowY: "auto",
              maxHeight: 190,
              minWidth: 0,
            }}
          >
            {context.map((index) => {
              const current = index === editingLine;
              const text = current ? editingValue : lines[index] ?? "";
              return (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    gap: 10,
                    minWidth: 0,
                    padding: "1px 4px",
                    borderRadius: 2,
                    background: current ? "rgba(103,193,245,0.16)" : "transparent",
                  }}
                >
                  <span style={gutterStyle}>{index + 1}</span>
                  {current ? (
                    <span style={{ minWidth: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      {text.slice(0, caret)}
                      <span
                        style={{
                          display: "inline-block",
                          width: 0,
                          borderLeft: "2px solid #67c1f5",
                          height: "1em",
                          verticalAlign: "text-bottom",
                        }}
                      />
                      {text.slice(caret)}
                    </span>
                  ) : (
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        opacity: text.length ? 0.6 : 0.25,
                      }}
                    >
                      {text}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 11, opacity: 0.5, padding: "0 2px 4px" }}>{t("editor.edit_hint")}</div>

          {/* Steam's own field, kept for a hardware keyboard and for anyone
              whose on-screen keyboard does come up; the keys below type
              without it. */}
          <div data-line-input style={{ padding: "0 0 4px", minWidth: 0 }}>
            <TextField
              value={editingValue}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onEditingText(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)
              }
              bShowCopyAction={false}
            />
          </div>

          <OnScreenKeyboard
            onKey={onInsertText}
            onBackspace={onBackspace}
            onSpace={() => onInsertText(" ")}
            onEnter={onEnter}
            onCaret={onCaret}
            onLine={onMoveLine}
            onDone={onApplyLine}
          />

          <Focusable style={{ display: "flex", gap: 6, paddingTop: 6, paddingBottom: 8 }}>
            <DialogButton style={{ flex: 1, fontSize: 13 }} onClick={() => onInsertLine(editingLine)}>{t("editor.insert_line")}</DialogButton>
            <DialogButton style={{ flex: 1, fontSize: 13 }} onClick={() => onDeleteLine(editingLine)}>{t("editor.delete_line")}</DialogButton>
            <DialogButton style={{ flex: 1, fontSize: 13 }} onClick={onClearLine}>{t("editor.clear_line")}</DialogButton>
            <DialogButton style={{ flex: 1, fontSize: 13 }} onClick={onCancelLine}>{t("action.cancel")}</DialogButton>
          </Focusable>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, opacity: 0.5, padding: "0 2px 6px" }}>{loading ? t("editor.loading") : t("editor.hint")}</div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", minWidth: 0, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, background: "rgba(0,0,0,0.3)" }}>
            <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_Y}>
              {lines.slice(0, visibleLines).map((line, index) => (
                <div key={index}>
                  <PanelSectionRow>
                    <Focusable onActivate={() => onStartLine(index)}>
                      <ButtonItem onClick={() => onStartLine(index)} layout="below">
                        <div style={{ width: "100%", display: "flex", gap: 10, minWidth: 0, textAlign: "left", ...monospace }}>
                          <span style={gutterStyle}>{index + 1}</span>
                          <span
                            style={{
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              opacity: line.length ? 0.95 : 0.35,
                              fontStyle: line.length ? "normal" : "italic",
                            }}
                          >
                            {line.length ? line : t("editor.line_empty")}
                          </span>
                        </div>
                      </ButtonItem>
                    </Focusable>
                  </PanelSectionRow>
                </div>
              ))}

              {lines.length > visibleLines ? (
                <PanelSectionRow>
                  <ButtonItem onClick={onShowMore}>
                    {t("action.show_more").replace("{count}", String(lines.length - visibleLines))}
                  </ButtonItem>
                </PanelSectionRow>
              ) : null}
            </Focusable>
          </div>

          <div style={{ fontSize: 11, opacity: 0.5, padding: "6px 2px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}>
            {buffer.path}
          </div>

          <Focusable style={{ display: "flex", gap: 8, paddingBottom: 8 }}>
            <DialogButton
              style={{ flex: 1 }}
              disabled={buffer.readOnly || loading || saving || !dirty}
              onClick={() => onSave(false)}
            >
              {saving ? t("editor.saving") : t("action.save")}
            </DialogButton>
            <DialogButton style={{ flex: 1 }} onClick={onClose}>{t("action.close")}</DialogButton>
          </Focusable>
        </>
      )}
    </div>
  );
}

const GAMEPAD_BUTTON_B = 1;
const GAMEPAD_BUTTON_X = 2;
const GAMEPAD_BUTTON_Y = 3;
const GAMEPAD_BUTTON_LSHOULDER = 30;
const GAMEPAD_BUTTON_RSHOULDER = 31;
// A tap on B walks up one directory, so leaving from a deep path used to mean
// one press per level. Holding B long enough to be deliberate exits outright.
const EXIT_HOLD_MS = 800;
// How long after a modal closes a B press still counts as "that was the
// dismissal", rather than a fresh request to walk up a directory.
const OVERLAY_GRACE_MS = 400;

function FileManagerPage() {
  const paneA = usePane(0, "/home/deck");
  const paneB = usePane(1, "/home/deck");
  const panesRef = useRef<[PaneApi, PaneApi]>([paneA, paneB]);
  panesRef.current = [paneA, paneB];

  const [dualPane, setDualPane] = useState(false);
  const dualPaneRef = useRef(false);
  // Mirror the rendered state every render. Maintaining this ref by hand
  // inside the setter let it drift out of sync with what is on screen.
  dualPaneRef.current = dualPane;
  const [activePaneIndex, setActivePaneIndex] = useState<PaneIndex>(0);
  const activePaneIndexRef = useRef<PaneIndex>(0);
  const paneBInitialized = useRef(false);
  const paneContainerRefs = useRef<Record<PaneIndex, HTMLDivElement | null>>({ 0: null, 1: null });

  const activePane = activePaneIndex === 0 ? paneA : paneB;

  const [drives, setDrives] = useState<DriveEntry[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [sortOrder, setSortOrder] = useState("asc");
  const [fileTypeFilter, setFileTypeFilter] = useState("all");

  const backTimeout = useRef<number | null>(null);
  const exitHoldFrame = useRef<number | null>(null);
  const [exitHoldActive, setExitHoldActive] = useState(false);
  const [exitHoldFilled, setExitHoldFilled] = useState(false);
  const isLongBack = useRef(false);
  const backPressed = useRef(false);
  const backHadOverlayOnPress = useRef(false);
  const backConsumedOnPress = useRef(false);
  const lastOverlayRemovedAt = useRef<number>(0);
  const isPluginActive = useRef(false);
  const contextMenuInstance = useRef<{ Hide(): void } | null>(null);
  const pathInputScopeRef = useRef<HTMLDivElement | null>(null);
  const pathInputFocusedRef = useRef(false);
  const pathInputBlurTimerRef = useRef<number | null>(null);
  const pathInputLastFocusRef = useRef(0);

  const registerPaneContainer = useCallback((index: PaneIndex, element: HTMLDivElement | null) => {
    paneContainerRefs.current[index] = element;
  }, []);

  const setActivePane = useCallback((index: PaneIndex) => {
    if (activePaneIndexRef.current === index) return;
    activePaneIndexRef.current = index;
    setActivePaneIndex(index);
  }, []);

  const [paneFocusRequest, setPaneFocusRequest] = useState(0);

  /** Move gamepad focus into a panel, preferring the row it was left on. */
  const focusPane = useCallback((index: PaneIndex) => {
    activePaneIndexRef.current = index;
    setActivePaneIndex(index);
    // Focusing here would race the re-render this very call triggers: Steam
    // restores its own focus afterwards and the panel switch silently fails
    // about half the time. Hand it to an effect that runs after the commit.
    setPaneFocusRequest((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!paneFocusRequest) return;

    let cancelled = false;

    const attempt = (triesLeft: number) => {
      if (cancelled) return;

      const index = activePaneIndexRef.current;
      const container = paneContainerRefs.current[index];

      if (container) {
        const remembered = panesRef.current[index].focusPathRef.current;
        let row: HTMLElement | null = null;
        if (remembered) {
          try {
            row = container.querySelector<HTMLElement>(`[data-item-path="${CSS.escape(remembered)}"]`);
          } catch {
            row = null;
          }
        }
        if (!row) {
          row = container.querySelector<HTMLElement>("[data-item-path]");
        }

        const target = getFocusableElements(row ?? container)[0];
        if (target) {
          try {
            target.focus();
          } catch {
          }
          if (document.activeElement === target) return;
        }
      }

      // The panel may still be loading, or Steam may have taken focus back.
      if (triesLeft > 0) {
        window.setTimeout(() => attempt(triesLeft - 1), 60);
      }
    };

    attempt(5);

    return () => {
      cancelled = true;
    };
  }, [paneFocusRequest]);

  const focusPaneRef = useRef(focusPane);
  focusPaneRef.current = focusPane;

  const stabilizePathInputFocus = useCallback(() => {
    const focusInput = () => {
      const input = pathInputScopeRef.current?.querySelector<HTMLInputElement>("input");
      if (input && document.activeElement !== input) {
        input.focus();
      }
    };

    window.setTimeout(focusInput, 0);
    window.setTimeout(focusInput, 80);
    window.setTimeout(focusInput, 180);
  }, []);

  const hasActiveModalRef = useRef(false);

  /**
   * Whether a keyboard/controller shortcut should be swallowed.
   *
   * Deliberately narrow: a document-wide querySelector for things like
   * [aria-haspopup] also matches Steam's own chrome and is therefore true all
   * the time, which silently kills every shortcut. Only an overlay that
   * actually holds focus counts.
   */
  const isShortcutBlocked = useCallback(() => {
    if (hasActiveModalRef.current || editorOpenRef.current) return true;
    if (typeof document === "undefined") return false;

    const active = document.activeElement as HTMLElement | null;
    return Boolean(active?.closest("[role='menu'], [role='dialog'], [data-modal-root], [data-decky-modal], .contextMenu, .contextMenuContents, .BasicContextMenuModal"));
  }, []);

  /**
   * Focus lands on the path field when the plugin opens, so panel shortcuts
   * must work from there rather than being swallowed. Step out of the field
   * first so the press does not also edit the path.
   */
  const leavePathInput = useCallback(() => {
    if (typeof document === "undefined") return;
    const active = document.activeElement as HTMLElement | null;
    if (!isTextInputElement(active)) return;

    pathInputFocusedRef.current = false;
    pathInputLastFocusRef.current = 0;
    if (pathInputBlurTimerRef.current !== null) {
      window.clearTimeout(pathInputBlurTimerRef.current);
      pathInputBlurTimerRef.current = null;
    }
    try {
      active?.blur();
    } catch {
    }
  }, []);

  // Progress feedback for the exit hold. Without it the hold is invisible and
  // people keep tapping B, which just walks them up one directory at a time.
  const beginExitHold = useCallback(() => {
    setExitHoldActive(true);
    setExitHoldFilled(false);
    if (exitHoldFrame.current !== null) {
      window.cancelAnimationFrame(exitHoldFrame.current);
    }
    // The bar fills through a CSS transition, so the filled width has to land
    // on a later frame than the mount or it snaps straight to the end state.
    exitHoldFrame.current = window.requestAnimationFrame(() => {
      exitHoldFrame.current = window.requestAnimationFrame(() => {
        exitHoldFrame.current = null;
        setExitHoldFilled(true);
      });
    });
  }, []);

  const endExitHold = useCallback(() => {
    if (exitHoldFrame.current !== null) {
      window.cancelAnimationFrame(exitHoldFrame.current);
      exitHoldFrame.current = null;
    }
    setExitHoldActive(false);
    setExitHoldFilled(false);
  }, []);

  // The editor takes over the page, so the browser's own shortcuts have to
  // stand down while it is up.
  const editorOpenRef = useRef(false);

  const openContextMenuRef = useRef<(item: FileEntry | null) => void>(() => null);
  const getCurrentFocusedItemRef = useRef<() => FileEntry | null>(() => null);
  const goBackRef = useRef<() => void>(() => null);
  const exitPluginRef = useRef<() => void>(() => null);
  const toggleDualPaneRef = useRef<() => void>(() => null);

  const editorBackRef = useRef<() => void>(() => null);
  const editorShoulderRef = useRef<(delta: number) => void>(() => null);

  const exitPlugin = useCallback(() => {
    Router.CloseSideMenus();
    Navigation.NavigateBack?.();
  }, []);

  const handleCancel = useCallback(() => {
  }, []);

  const goBack = useCallback(() => {
    if (editorOpenRef.current) {
      editorBackRef.current();
      return;
    }
    const pane = panesRef.current[activePaneIndexRef.current];
    pane.setError(null);
    if (!pane.goUp()) {
      exitPlugin();
    }
  }, [exitPlugin]);

  const refreshDrives = useCallback(async () => {
    try {
      const res = await listDrives();
      setDrives(res.drives ?? []);
    } catch (e) {
      console.warn("drives: could not enumerate", e);
      setDrives([]);
    }
  }, []);

  const refreshRecent = useCallback(async () => {
    setRecentPaths(recentEntriesFrom(loadRecentPaths()));
  }, []);

  const goToRecent = useCallback((entry: RecentEntry) => {
    const pane = panesRef.current[activePaneIndexRef.current];
    pane.setError(null);
    void pane.loadPath(entry.path, t("error.directory_not_found"));
  }, []);

  const [recentPaths, setRecentPaths] = useState<RecentEntry[]>([]);

  const initialLoadDone = useRef(false);

  const [i18nVersion, setI18nVersion] = useState(0);
  void i18nVersion;

  useEffect(() => {
    void (async () => {
      try {
        const REMOTE_BASE = (pluginInfo && (pluginInfo as any).translations_base_url) || "";
        await loadRemoteTranslations(REMOTE_BASE || undefined);
        setI18nVersion((v) => v + 1);
        console.info("i18n: active locale:", getLocale());
      } catch (e) {
        console.warn("i18n: remote load failed", e);
      }
    })();

    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    const [first] = panesRef.current;
    void first.loadPath(first.pathRef.current);
    void refreshDrives();
  }, [refreshDrives]);

  // Opening the split clones the current folder into the new panel once, then
  // each panel keeps its own location. Driven off the state rather than the
  // setter so it runs no matter who flipped the split.
  useEffect(() => {
    if (!dualPane) return;
    if (paneBInitialized.current) return;
    paneBInitialized.current = true;

    const [first, second] = panesRef.current;
    const source = panesRef.current[activePaneIndexRef.current];
    const target = source.index === 0 ? second : first;
    void target.loadPath(source.pathRef.current, undefined, false, null);
  }, [dualPane]);

  // A functional update cannot go stale, and setDualPane is a plain useState
  // setter, so calling it twice with the same value is inherently harmless.
  const toggleDualPane = useCallback(() => {
    setDualPane((prev) => !prev);
  }, []);

  const goToDrive = useCallback((drive: DriveEntry) => {
    const pane = panesRef.current[activePaneIndexRef.current];
    pane.setError(null);
    void pane.loadPath(drive.path, t("error.directory_not_found"));
  }, []);

  const hasClipboard = callable<[], { has: boolean }>("has_clipboard");
  const copyPath = callable<[string], { ok: boolean }>("copy_path");
  const cutPath = callable<[string], { ok: boolean }>("cut_path");
  const pastePathWithOptions = callable<[string, string, boolean], { ok: boolean; skipped?: boolean; cancelled?: boolean; conflict_strategy?: string }>("paste_path_with_options");
  const checkPasteConflict = callable<[string], { blocked: boolean; reason?: string; needs_conflict?: boolean; path?: string; name: string; is_dir?: boolean }>("check_paste_conflict");
  const checkTransferConflict = callable<[string, string], { needs_conflict?: boolean; path?: string; name: string; is_dir?: boolean }>("check_transfer_conflict");
  const transferPath = callable<[string, string, string, string], { ok: boolean; success?: boolean; new_path?: string; skipped?: boolean; cancelled?: boolean }>("transfer_path");
  const extractArchive = callable<[string, string], { success: boolean; new_path?: string }>("extract_archive");
  const renamePath = callable<[string, string], { success: boolean; new_path: string }>("rename_item");
  const deletePath = callable<[string], { success: boolean; error?: string }>("delete_item");
  const getProperties = callable<[string], {
    name: string;
    path: string;
    type: "file" | "folder";
    size: number | null;
    created: string;
    modified: string;
    permissions: string;
  }>("get_properties");
  const getDirectorySize = callable<[string], { size: number | null; path: string }>("get_directory_size");
  const createFileCallable = callable<[string, string], { success: boolean; path?: string; new_path?: string }>("create_file");

  const [clipboardHas, setClipboardHas] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const setError = setErrorState;
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [renameRequested, setRenameRequested] = useState(false);
  const renameModalRef = useRef<HTMLDivElement | null>(null);
  const renameSaveRef = useRef<HTMLButtonElement | null>(null);
  const [deleteRequested, setDeleteRequested] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const deleteModalRef = useRef<HTMLDivElement | null>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement | null>(null);
  const [propertiesRequested, setPropertiesRequested] = useState(false);
  const propertiesModalRef = useRef<HTMLDivElement | null>(null);
  const propertiesCloseRef = useRef<HTMLButtonElement | null>(null);
  const [isCalculatingFolderSize, setIsCalculatingFolderSize] = useState(false);

  const [propertiesData, setPropertiesData] = useState<{
    name: string;
    path: string;
    type: "file" | "folder";
    size: number | null;
    created: string;
    modified: string;
    permissions: string;
  } | null>(null);

  type ConflictModalState = {
    title: string;
    message: string;
    targetDir: string;
    itemName: string;
    isFolderConflict: boolean;
    transfer?: { srcPath: string; mode: "copy" | "cut" };
  } | null;
  type OperationModalState = {
    label: string;
    progress: number;
  } | null;
  type PermissionModalState = {
    message: string;
  } | null;

  const [conflictModal, setConflictModal] = useState<ConflictModalState>(null);
  const [operationModal, setOperationModal] = useState<OperationModalState>(null);
  const [operationCancelRequested, setOperationCancelRequested] = useState(false);
  const [permissionModal, setPermissionModal] = useState<PermissionModalState>(null);
  const conflictPrimaryRef = useRef<HTMLButtonElement | null>(null);
  const permissionPrimaryRef = useRef<HTMLButtonElement | null>(null);

  const [editorBuffer, setEditorBuffer] = useState<EditorBuffer | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorSaved, setEditorSaved] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorStale, setEditorStale] = useState(false);
  const [editorDiscardPrompt, setEditorDiscardPrompt] = useState(false);
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  // Where the next character goes. Typing used to only ever append, which made
  // fixing anything but the end of a line a matter of deleting back to it.
  const [editingCaret, setEditingCaret] = useState(0);
  const [visibleLines, setVisibleLines] = useState(150);

  // Read by the controller handler and the state updaters, which must not
  // close over a render's worth of stale editor state.
  const editorBufferRef = useRef<EditorBuffer | null>(null);
  editorBufferRef.current = editorBuffer;
  const editingLineRef = useRef<number | null>(null);
  editingLineRef.current = editingLine;
  const editingValueRef = useRef("");
  editingValueRef.current = editingValue;
  const editingCaretRef = useRef(0);
  editingCaretRef.current = editingCaret;
  const editorDiscardPromptRef = useRef(false);
  editorDiscardPromptRef.current = editorDiscardPrompt;
  const editorSavingRef = useRef(false);
  editorOpenRef.current = editorBuffer !== null;

  const [createFolderRequested, setCreateFolderRequested] = useState(false);
  const [createFolderName, setCreateFolderName] = useState("");
  const createFolderRef = useRef<HTMLDivElement | null>(null);
  const createFolderConfirmRef = useRef<HTMLButtonElement | null>(null);
  const [createFileRequested, setCreateFileRequested] = useState(false);
  const [createFileName, setCreateFileName] = useState("");
  const createFileRef = useRef<HTMLDivElement | null>(null);
  const createFileConfirmRef = useRef<HTMLButtonElement | null>(null);
  const fileManagerScopeRef = useRef<HTMLDivElement | null>(null);
  const hasActiveModal = renameRequested || deleteRequested || propertiesRequested || createFolderRequested || createFileRequested || !!conflictModal || !!operationModal || !!permissionModal;
  hasActiveModalRef.current = hasActiveModal;

  // Steam dismisses a modal on the B *press*, through the Focusable's own
  // cancel handling, and our listener sees the *release* afterwards. By then
  // the modal is gone, so the release used to fall through to "go up one
  // directory" — closing the editor and leaving the folder in one press.
  // Recording when the overlay went away arms the grace window below.
  const overlayWasOpenRef = useRef(false);

  useEffect(() => {
    if (hasActiveModal) {
      overlayWasOpenRef.current = true;
      return;
    }
    if (overlayWasOpenRef.current) {
      overlayWasOpenRef.current = false;
      lastOverlayRemovedAt.current = Date.now();
    }
  }, [hasActiveModal]);

  const isDropdownMenuOpenInDom = useCallback(() => {
    if (typeof document === "undefined") return false;

    const dropdownMenu = document.querySelector<HTMLElement>("[role='menu'], .contextMenu, .contextMenuContents, .BasicContextMenuModal");
    if (!dropdownMenu) return false;

    const activeElement = document.activeElement as HTMLElement | null;
    return Boolean(activeElement?.closest("[role='menu'], .contextMenu, .contextMenuContents, .BasicContextMenuModal") || dropdownMenu.closest("[role='menu'], .contextMenu, .contextMenuContents, .BasicContextMenuModal"));
  }, []);

  const focusActiveModal = useCallback(() => {
    if (typeof document === "undefined") return;

    const focusableSelector = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1']):not([disabled])",
    ].join(", ");

    const modalScope = document.querySelector<HTMLElement>("[role='dialog'], [data-modal-root], [data-decky-modal]");
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
      if (element.closest("[inert]")) return false;
      if (element.getAttribute("aria-hidden") === "true") return false;
      if (element.hasAttribute("disabled")) return false;
      const withinModal = modalScope ? element.closest("[role='dialog'], [data-modal-root], [data-decky-modal]") : null;
      if (modalScope && !withinModal) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    });

    const preferred = candidates.find((element) => element.offsetParent !== null || element.getClientRects().length > 0);
    if (preferred) {
      try {
        preferred.focus();
      } catch {
      }
      return;
    }

    if (modalScope) {
      try {
        modalScope.focus();
      } catch {
      }
    }
  }, []);

  useEffect(() => {
    if (!hasActiveModal) return;

    const timer = window.setTimeout(() => {
      focusActiveModal();
    }, 60);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        focusActiveModal();
        return;
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        const activeElement = document.activeElement as HTMLElement | null;
        if (activeElement && !activeElement.closest("[role='dialog'], [data-modal-root]")) {
          event.preventDefault();
          event.stopPropagation();
          focusActiveModal();
        }
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const modalScope = document.querySelector<HTMLElement>("[role='dialog'], [data-modal-root], [data-decky-modal]");
      if (!modalScope) return;

      if (!target.closest("[role='dialog'], [data-modal-root], [data-decky-modal]")) {
        event.stopPropagation();
        focusActiveModal();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn, true);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
    };
  }, [focusActiveModal, hasActiveModal]);

  useEffect(() => {
    (async () => {
      try {
        const res = await hasClipboard();
        setClipboardHas(res.has);
      } catch {
        setClipboardHas(false);
      }
    })();
  }, [hasClipboard, activePane.path]);

  const isAnyModalOrMenuOpen = useCallback(() => {
    if (contextMenuInstance.current) {
      return true;
    }

    if (typeof document !== "undefined") {
      const activeElement = document.activeElement as HTMLElement | null;
      const overlaySelector = [
        ".contextMenu",
        ".contextMenuContents",
        ".BasicContextMenuModal",
        "[role='menu']",
        "[role='dialog']",
        "[data-modal-root]",
        "[data-decky-modal]",
        "[aria-expanded='true']",
        "[aria-haspopup]",
      ].join(", ");

      const overlayOpen = document.querySelector(overlaySelector);
      const activeElementIsOverlay = activeElement?.closest(overlaySelector);
      if (overlayOpen || activeElementIsOverlay) {
        return true;
      }
    }

    return propertiesRequested || renameRequested || deleteRequested || createFolderRequested || createFileRequested || !!conflictModal || !!operationModal || !!permissionModal;
  }, [propertiesRequested, renameRequested, deleteRequested, createFolderRequested, createFileRequested, conflictModal, operationModal, permissionModal]);

  useEffect(() => {
    const input = (window as any).SteamClient?.Input;
    let unregister: any;

    if (input?.RegisterForControllerInputMessages) {
      unregister = input.RegisterForControllerInputMessages(
        (_controllerIndex: number, gamepadButton: number, isPressed: boolean) => {
          if (!isPluginActive.current) return;

          if (gamepadButton === GAMEPAD_BUTTON_Y && isPressed) {
            // The options menu belongs to the file list; opening it over a
            // modal buries the modal under a menu about the file behind it.
            if (hasActiveModalRef.current || editorOpenRef.current) return;
            const item = getCurrentFocusedItemRef.current();
            openContextMenuRef.current(item);
            return;
          }

          // X toggles the split; the shoulder buttons jump between panels and
          // R1 opens the split when there is nothing to the right yet.
          if (gamepadButton === GAMEPAD_BUTTON_X && isPressed) {
            if (isShortcutBlocked()) return;
            leavePathInput();
            toggleDualPaneRef.current();
            return;
          }

          if ((gamepadButton === GAMEPAD_BUTTON_LSHOULDER || gamepadButton === GAMEPAD_BUTTON_RSHOULDER) && isPressed) {
            // Nothing to switch between inside the editor, so they move the
            // text cursor instead.
            if (editorOpenRef.current && !hasActiveModalRef.current) {
              editorShoulderRef.current(gamepadButton === GAMEPAD_BUTTON_LSHOULDER ? -1 : 1);
              return;
            }
            if (isShortcutBlocked()) return;
            leavePathInput();

            // Only ever move between panels. Opening the split from here made
            // R1 reinstate a view the user had just closed.
            if (!dualPaneRef.current) return;

            const target: PaneIndex = gamepadButton === GAMEPAD_BUTTON_LSHOULDER ? 0 : 1;
            focusPaneRef.current(target);
            return;
          }

          if (gamepadButton !== GAMEPAD_BUTTON_B) return;
          if (isPressed) {
            if (backPressed.current) return;

            const activeElement = document.activeElement as HTMLElement | null;
            const pathInputWasRecentlyFocused = Date.now() - pathInputLastFocusRef.current < 3000;
            // While a modal is up the path field is inert and cannot hold
            // focus, so blurring it would only swallow the press that is
            // meant to dismiss the modal.
            if (!hasActiveModalRef.current && (pathInputFocusedRef.current || pathInputWasRecentlyFocused || (activeElement instanceof HTMLElement && activeElement.closest("[data-path-input]")))) {
              pathInputFocusedRef.current = false;
              pathInputLastFocusRef.current = 0;
              if (pathInputBlurTimerRef.current !== null) {
                window.clearTimeout(pathInputBlurTimerRef.current);
                pathInputBlurTimerRef.current = null;
              }
              activeElement?.blur();
              return;
            }

            const hasOverlay = hasActiveModalRef.current || isAnyModalOrMenuOpen();
            const dropdownMenuOpen = isDropdownMenuOpenInDom();
            const shouldConsumeBack = hasOverlay || dropdownMenuOpen || Boolean(activeElement?.closest("[role='menu'], [role='dialog'], [data-modal-root], [data-decky-modal], [aria-expanded='true'], [aria-haspopup], .contextMenu, .contextMenuContents, .BasicContextMenuModal"));

            backPressed.current = true;
            backHadOverlayOnPress.current = shouldConsumeBack;
            backConsumedOnPress.current = shouldConsumeBack;

            if (shouldConsumeBack) {
              if (contextMenuInstance.current) {
                contextMenuInstance.current.Hide();
                contextMenuInstance.current = null;
              }

              const overlayElement = activeElement?.closest("[role='menu'], [role='dialog'], [data-modal-root], [data-decky-modal], .contextMenu, .contextMenuContents, .BasicContextMenuModal") as HTMLElement | null;
              if (overlayElement) {
                try {
                  overlayElement.blur?.();
                } catch {
                }
              }

              if (dropdownMenuOpen) {
                try {
                  const containers = Array.from(document.querySelectorAll<HTMLElement>(
                    ".contextMenu, .contextMenuContents, [role='menu']"
                  ));

                  let closed = false;
                  for (const c of containers) {
                    if (!c || !(c.offsetWidth || c.offsetHeight || c.getClientRects().length)) continue;
                    const candidates = Array.from(c.querySelectorAll<HTMLElement>("button, [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], div"));
                    const cancel = candidates.find((e) => /cancelar|cancel|fechar|close/i.test((e.textContent || "").trim()));
                    if (cancel) {
                      try {
                        cancel.click();
                        closed = true;
                        break;
                      } catch {
                      }
                    }
                  }

                  if (!closed) {
                    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
                    activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
                  }
                } catch {
                }

                return;
              }

              const dismissableDropdown = document.querySelector<HTMLElement>("[aria-expanded='true'], [aria-haspopup]");
              if (dismissableDropdown) {
                try {
                  dismissableDropdown.setAttribute("aria-expanded", "false");
                } catch {
                }
              }

              return;
            }
            isLongBack.current = false;
            if (backTimeout.current) {
              window.clearTimeout(backTimeout.current);
            }
            // A press that only just dismissed a modal must not start the
            // hold-to-exit timer either.
            if (lastOverlayRemovedAt.current && Date.now() - lastOverlayRemovedAt.current < OVERLAY_GRACE_MS) {
              backConsumedOnPress.current = true;
              return;
            }
            beginExitHold();
            backTimeout.current = window.setTimeout(() => {
              isLongBack.current = true;
              backTimeout.current = null;
              endExitHold();
              exitPluginRef.current();
            }, EXIT_HOLD_MS);
          } else {
            if (!backPressed.current) return;
            backPressed.current = false;
            if (backTimeout.current) {
              window.clearTimeout(backTimeout.current);
              backTimeout.current = null;
            }
            endExitHold();
            const now = Date.now();
            if (
              backHadOverlayOnPress.current ||
              backConsumedOnPress.current ||
              (lastOverlayRemovedAt.current && now - lastOverlayRemovedAt.current < OVERLAY_GRACE_MS)
            ) {
              backHadOverlayOnPress.current = false;
              backConsumedOnPress.current = false;
              lastOverlayRemovedAt.current = 0;
              return;
            }
            if (!isLongBack.current) {
              goBackRef.current();
            }
            isLongBack.current = false;
          }
        },
      );
    }

    return () => {
      if (backTimeout.current) {
        window.clearTimeout(backTimeout.current);
        backTimeout.current = null;
      }
      endExitHold();
      if (typeof unregister === "function") {
        unregister();
      } else if (unregister?.Unregister) {
        unregister.Unregister();
      }
    };
  }, [beginExitHold, endExitHold, isAnyModalOrMenuOpen, isDropdownMenuOpenInDom, isShortcutBlocked, leavePathInput]);

  useEffect(() => {
    if (renameRequested) {
      setTimeout(() => {
        const input = renameModalRef.current?.querySelector<HTMLInputElement>("input");
        input?.focus();
        input?.select();
      }, 50);
    }
  }, [renameRequested]);

  useEffect(() => {
    if (propertiesRequested) {
      setTimeout(() => {
        const btn = propertiesCloseRef.current ?? propertiesModalRef.current?.querySelector<HTMLButtonElement>("button");
        try {
          btn?.focus();
        } catch (e) {
        }
      }, 50);
    }
  }, [propertiesRequested]);

  useEffect(() => {
    if (deleteRequested) {
      setTimeout(() => {
        const btn = deleteConfirmRef.current ?? deleteModalRef.current?.querySelector<HTMLButtonElement>("button");
        try { btn?.focus(); } catch (e) {}
      }, 50);
    }
  }, [deleteRequested]);

  useEffect(() => {
    if (createFileRequested) {
      setTimeout(() => {
        const input = createFileRef.current?.querySelector<HTMLInputElement>("input");
        input?.focus();
        // A new file is almost always "name.ext"; put the caret before the
        // extension so typing replaces the stem rather than appending to it.
        input?.select();
      }, 50);
    }
  }, [createFileRequested]);

  useEffect(() => {
    if (!conflictModal) return;
    const timeout = window.setTimeout(() => {
      conflictPrimaryRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(timeout);
  }, [conflictModal]);

  useEffect(() => {
    if (!permissionModal) return;
    const timeout = window.setTimeout(() => {
      permissionPrimaryRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(timeout);
  }, [permissionModal]);

  const refreshClipboard = useCallback(async () => {
    try {
      const res = await hasClipboard();
      setClipboardHas(res.has);
    } catch {
      setClipboardHas(false);
    }
  }, [hasClipboard]);

  const refreshPanes = useCallback(async () => {
    const [first, second] = panesRef.current;
    await first.refresh();
    if (paneBInitialized.current) {
      await second.refresh();
    }
  }, []);

  const isOperationRunning = useRef(false);

  const runOperation = useCallback(
    async (label: string, action: () => Promise<any>, options?: { onError?: (e: any) => void; onSuccess?: (res: any) => void }) => {
      if (isOperationRunning.current) {
        setError(t("action.another_running"));
        return null;
      }
      isOperationRunning.current = true;

      setOperationCancelRequested(false);
      setOperationModal({ label, progress: 0 });
      const interval = window.setInterval(() => {
        setOperationModal((prev) => prev ? { ...prev, progress: Math.min(prev.progress + 7, 95) } : prev);
      }, 160);

      try {
        const res = await action();

        if (operationCancelRequested) {
          setOperationModal(null);
          setError(t("action.cancelled"));
          await refreshClipboard();
          return null;
        }

        if (res && typeof res === "object" && "success" in res && res.success === false) {
          const err = (res as any).error ?? t("action.failed");
          throw new Error(err);
        }

        setOperationModal((prev) => prev ? { ...prev, progress: 100 } : prev);

        await refreshClipboard();
        await refreshPanes();
        void refreshDrives();

        if (options?.onSuccess) {
          options.onSuccess(res);
        } else if (res && typeof res === "object" && (res as any).new_path) {
          panesRef.current[activePaneIndexRef.current].setFocusPath((res as any).new_path as string);
        }

        window.setTimeout(() => setOperationModal(null), 220);
        return res;
      } catch (e: any) {
        setOperationModal(null);
        await refreshClipboard();

        if (options?.onError) {
          options.onError(e);
        } else {
          setError(e?.message ?? t("action.failed"));
        }
        return null;
      } finally {
        window.clearInterval(interval);
        setOperationCancelRequested(false);
        isOperationRunning.current = false;
      }
    },
    [operationCancelRequested, refreshClipboard, refreshPanes, refreshDrives, setError],
  );

  const handleOperationError = useCallback((e: any, fallbackKey: string) => {
    const message = String(e?.message ?? t(fallbackKey));
    // The backend raises Portuguese messages; "permissão" is the marker that
    // this is an access problem rather than a real failure worth inlining.
    if (message.toLowerCase().includes("permissão")) {
      setPermissionModal({ message: t("permission.denied") });
    } else {
      setError(message);
    }
  }, [setError]);

  const handlePaste = useCallback(async (targetDir: string) => {
    try {
      const conflict = await checkPasteConflict(targetDir);
      if (conflict.blocked) {
        setPermissionModal({ message: t("paste.blocked") });
        return;
      }

      if (conflict.needs_conflict) {
        setConflictModal({
          title: conflict.is_dir ? t("conflict.folder_exists") : t("conflict.file_exists"),
          message: t("conflict.message").replace("{name}", conflict.name),
          targetDir,
          itemName: conflict.name,
          isFolderConflict: Boolean(conflict.is_dir),
        });
        return;
      }

      await runOperation(t("action.pasting"), () => pastePathWithOptions(targetDir, "keep-both", false), {
        onError: (e) => handleOperationError(e, "action.failed"),
      });
    } catch (e: any) {
      setError(e?.message ?? t("error.prepare_paste"));
    }
  }, [checkPasteConflict, runOperation, handleOperationError, setError]);

  /** Copy or move straight into the other panel — the point of a split view. */
  const handleTransferToOtherPane = useCallback(async (item: FileEntry, mode: "copy" | "cut") => {
    const source = panesRef.current[activePaneIndexRef.current];
    const destination = panesRef.current[source.index === 0 ? 1 : 0];
    const targetDir = destination.pathRef.current;

    if (parentDirOf(item.path) === targetDir) {
      setError(t("error.same_folder"));
      return;
    }

    const label = mode === "copy" ? t("action.copying") : t("action.moving");

    try {
      const conflict = await checkTransferConflict(item.path, targetDir);
      if (conflict.needs_conflict) {
        setConflictModal({
          title: conflict.is_dir ? t("conflict.folder_exists") : t("conflict.file_exists"),
          message: t("conflict.message").replace("{name}", conflict.name),
          targetDir,
          itemName: conflict.name,
          isFolderConflict: Boolean(conflict.is_dir),
          transfer: { srcPath: item.path, mode },
        });
        return;
      }

      await runOperation(label, () => transferPath(item.path, targetDir, mode, "keep-both"), {
        onError: (e) => handleOperationError(e, "action.failed"),
        onSuccess: (res) => {
          if (res?.new_path) destination.setFocusPath(res.new_path as string);
        },
      });
    } catch (e: any) {
      handleOperationError(e, "action.failed");
    }
  }, [checkTransferConflict, transferPath, runOperation, handleOperationError, setError]);

  const createFolderCallable = callable<[string, string], { success: boolean; path?: string }>("create_folder");

  const handleCreateFolder = useCallback(async (parentDir: string, name: string) => {
    if (!name) return setError(t("error.invalid_name"));
    await runOperation(t("action.creating_folder"), () => createFolderCallable(parentDir, name), {
      onError: (e) => {
        setError(e?.message ?? t("error.could_not_create_folder"));
      },
    });
    setCreateFolderRequested(false);
    setCreateFolderName("");
  }, [createFolderCallable, runOperation, setError]);

  const handleCreateFile = useCallback(async (parentDir: string, name: string) => {
    if (!name) return setError(t("error.invalid_name"));
    await runOperation(t("action.creating_file"), () => createFileCallable(parentDir, name), {
      onError: (e) => {
        setError(e?.message ?? t("error.could_not_create_file"));
      },
    });
    setCreateFileRequested(false);
    setCreateFileName("");
  }, [createFileCallable, runOperation, setError]);

  /**
   * The backend raises Portuguese messages; inside the editor a permission
   * problem is shown in the modal itself rather than stacking a second
   * ModalRoot on top of the one the user is looking at.
   */
  const openEditor = useCallback((item: FileEntry) => {
    setEditorBuffer({
      path: item.path,
      name: item.name,
      content: "",
      original: "",
      encoding: "utf-8",
      modified: 0,
      readOnly: false,
    });
    setEditorLoading(true);
    setEditorError(null);
    setEditorStale(false);
    setEditorSaved(false);
    setEditorDiscardPrompt(false);
    setEditingLine(null);
    setVisibleLines(150);

    void (async () => {
      try {
        const res = await readTextFile(item.path);
        setEditorBuffer({
          path: res.path,
          name: res.name,
          content: res.content,
          original: res.content,
          encoding: res.encoding,
          modified: res.modified,
          readOnly: res.read_only,
        });
      } catch (e: any) {
        setEditorError(backendErrorMessage(e, "error.could_not_open_file"));
      } finally {
        setEditorLoading(false);
      }
    })();
  }, []);

  const closeEditor = useCallback(() => {
    setEditorBuffer(null);
    setEditingLine(null);
    setEditorError(null);
    setEditorStale(false);
    setEditorDiscardPrompt(false);
  }, []);

  const saveEditor = useCallback((force: boolean) => {
    void (async () => {
      const buffer = editorBufferRef.current;
      if (!buffer || editorSavingRef.current) return;

      editorSavingRef.current = true;
      setEditorSaving(true);
      setEditorError(null);

      try {
        const res = await writeTextFile(buffer.path, buffer.content, buffer.modified, buffer.encoding, force);

        if (!res.success) {
          if (res.stale) {
            setEditorStale(true);
            return;
          }
          throw new Error(t("error.could_not_save_file"));
        }

        setEditorBuffer((prev) => prev ? {
          ...prev,
          original: prev.content,
          modified: res.modified,
          encoding: res.encoding ?? prev.encoding,
        } : prev);
        setEditorStale(false);
        setEditorSaved(true);
        window.setTimeout(() => setEditorSaved(false), 2000);
        void refreshPanes();
      } catch (e: any) {
        setEditorError(backendErrorMessage(e, "error.could_not_save_file"));
      } finally {
        editorSavingRef.current = false;
        setEditorSaving(false);
      }
    })();
  }, [refreshPanes]);

  const reloadEditor = useCallback(() => {
    const buffer = editorBufferRef.current;
    if (buffer) openEditor({ name: buffer.name, path: buffer.path, is_dir: false, size: null, modified: 0 });
  }, [openEditor]);

  const startEditLine = useCallback((index: number) => {
    const buffer = editorBufferRef.current;
    if (!buffer || buffer.readOnly) return;
    const line = buffer.content.split("\n")[index] ?? "";
    setEditingLine(index);
    setEditingValue(line);
    setEditingCaret(line.length);
  }, []);

  const setEditingText = useCallback((value: string, caret: number) => {
    setEditingValue(value);
    setEditingCaret(Math.max(0, Math.min(caret, value.length)));
  }, []);

  /**
   * The line being typed, written back into the buffer.
   *
   * Returns the whole file so callers that need the result now — moving to
   * another line, splitting one — can keep working from it instead of waiting
   * for the state to come back around on the next render.
   */
  const commitEditingLine = useCallback((): string[] | null => {
    const buffer = editorBufferRef.current;
    const index = editingLineRef.current;
    if (!buffer || index === null) return null;
    const lines = buffer.content.split("\n");
    lines[index] = editingValueRef.current;
    setEditorBuffer({ ...buffer, content: lines.join("\n") });
    return lines;
  }, []);

  const insertText = useCallback((text: string) => {
    const value = editingValueRef.current;
    const caret = Math.max(0, Math.min(editingCaretRef.current, value.length));
    setEditingValue(value.slice(0, caret) + text + value.slice(caret));
    setEditingCaret(caret + text.length);
  }, []);

  /** Deletes to the left of the cursor, joining onto the line above at column 1. */
  const backspaceEditing = useCallback(() => {
    const value = editingValueRef.current;
    const caret = Math.max(0, Math.min(editingCaretRef.current, value.length));
    if (caret > 0) {
      setEditingValue(value.slice(0, caret - 1) + value.slice(caret));
      setEditingCaret(caret - 1);
      return;
    }

    const buffer = editorBufferRef.current;
    const index = editingLineRef.current;
    if (!buffer || buffer.readOnly || index === null || index === 0) return;
    const lines = buffer.content.split("\n");
    const previous = lines[index - 1] ?? "";
    lines.splice(index - 1, 2, previous + value);
    setEditorBuffer({ ...buffer, content: lines.join("\n") });
    setEditingLine(index - 1);
    setEditingValue(previous + value);
    setEditingCaret(previous.length);
  }, []);

  const moveCaret = useCallback((delta: number) => {
    const length = editingValueRef.current.length;
    setEditingCaret(Math.max(0, Math.min(editingCaretRef.current + delta, length)));
  }, []);

  /** Commit this line, then carry on typing the one above or below it. */
  const moveEditingLine = useCallback((delta: number) => {
    const index = editingLineRef.current;
    const lines = commitEditingLine();
    if (!lines || index === null) return;

    const target = index + delta;
    if (target < 0 || target >= lines.length) return;

    const line = lines[target] ?? "";
    setEditingLine(target);
    setEditingValue(line);
    setEditingCaret(line.length);
    setVisibleLines((count) => Math.max(count, target + 2));
  }, [commitEditingLine]);

  /** Enter: break the line at the cursor and continue on the new one. */
  const splitEditingLine = useCallback(() => {
    const buffer = editorBufferRef.current;
    const index = editingLineRef.current;
    if (!buffer || buffer.readOnly || index === null) return;

    const value = editingValueRef.current;
    const caret = Math.max(0, Math.min(editingCaretRef.current, value.length));
    const head = value.slice(0, caret);
    const tail = value.slice(caret);

    const lines = buffer.content.split("\n");
    lines.splice(index, 1, head, tail);
    setEditorBuffer({ ...buffer, content: lines.join("\n") });
    setEditingLine(index + 1);
    setEditingValue(tail);
    setEditingCaret(0);
    setVisibleLines((count) => Math.max(count, index + 3));
  }, []);

  const applyLineEdit = useCallback(() => {
    commitEditingLine();
    setEditingLine(null);
  }, [commitEditingLine]);

  /** Add an empty line below and drop straight into typing it. */
  const insertLineAfter = useCallback((index: number) => {
    const buffer = editorBufferRef.current;
    if (!buffer || buffer.readOnly) return;
    const lines = buffer.content.split("\n");
    lines[index] = editingLineRef.current === index ? editingValueRef.current : lines[index] ?? "";
    lines.splice(index + 1, 0, "");
    setEditorBuffer({ ...buffer, content: lines.join("\n") });
    setEditingLine(index + 1);
    setEditingValue("");
    setEditingCaret(0);
    setVisibleLines((count) => Math.max(count, index + 3));
  }, []);

  const deleteLine = useCallback((index: number) => {
    setEditorBuffer((prev) => {
      if (!prev || prev.readOnly) return prev;
      const next = prev.content.split("\n");
      // A file always has at least one line; emptying the last one is a clear.
      if (next.length <= 1) return { ...prev, content: "" };
      next.splice(index, 1);
      return { ...prev, content: next.join("\n") };
    });
    setEditingLine(null);
  }, []);

  /**
   * B steps back one layer at a time rather than throwing the file away, and
   * keeps what was typed: the line is committed to the buffer, which still
   * leaves the file on disk untouched until Save.
   */
  const editorBack = useCallback(() => {
    if (editingLineRef.current !== null) {
      applyLineEdit();
      return;
    }
    if (editorDiscardPromptRef.current) {
      setEditorDiscardPrompt(false);
      return;
    }
    const buffer = editorBufferRef.current;
    if (buffer && buffer.content !== buffer.original) {
      setEditorDiscardPrompt(true);
      return;
    }
    closeEditor();
  }, [applyLineEdit, closeEditor]);

  editorBackRef.current = editorBack;

  // The shoulder buttons do nothing else while the editor is open, so they
  // drive the cursor: the most-wanted key without moving off the letter keys.
  const editorShoulder = useCallback((delta: number) => {
    if (editingLineRef.current === null) return;
    moveCaret(delta);
  }, [moveCaret]);

  editorShoulderRef.current = editorShoulder;

  const handleConflictChoice = useCallback(async (strategy: string, applyToAll = false) => {
    if (!conflictModal) return;

    const pending = conflictModal;
    setConflictModal(null);

    if (pending.transfer) {
      const destination = panesRef.current.find((pane) => pane.pathRef.current === pending.targetDir) ?? null;
      const label = pending.transfer.mode === "copy" ? t("action.copying") : t("action.moving");
      await runOperation(label, () => transferPath(pending.transfer!.srcPath, pending.targetDir, pending.transfer!.mode, strategy), {
        onError: (e) => handleOperationError(e, "action.failed"),
        onSuccess: (res) => {
          if (res?.new_path && destination) destination.setFocusPath(res.new_path as string);
        },
      });
      return;
    }

    await runOperation(t("action.pasting"), () => pastePathWithOptions(pending.targetDir, strategy, applyToAll), {
      onError: (e) => handleOperationError(e, "action.failed"),
    });
  }, [conflictModal, runOperation, transferPath, handleOperationError]);

  const openContextMenu = useCallback(
    (item: FileEntry | null) => {
      if (contextMenuInstance.current) {
        contextMenuInstance.current.Hide();
        contextMenuInstance.current = null;
      }

      const currentPane = panesRef.current[activePaneIndexRef.current];
      const currentDir = currentPane.pathRef.current;
      const splitOn = dualPaneRef.current;

      const anchor =
        (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? (document.activeElement as EventTarget) : undefined) ??
        (paneContainerRefs.current[currentPane.index] as EventTarget | null) ??
        undefined;

      const paste = () => void handlePaste(currentDir);
      const toggleSplit = () => {
        const next = !splitOn;
        // The menu lives in a separate React root that Steam tears down
        // synchronously on activation; a state update dispatched into our root
        // mid-teardown gets dropped. Close it, then apply on the next tick.
        if (contextMenuInstance.current) {
          contextMenuInstance.current.Hide();
          contextMenuInstance.current = null;
        }
        window.setTimeout(() => setDualPane(next), 0);
      };
      const clearRecent = () => {
        saveRecentPaths([]);
        setRecentPaths([]);
      };

      // One entry that opens the history, rather than a dozen loose entries
      // pushed to the bottom of the menu.
      const recentItems = recentPaths.map((entry) => {
        const go = () => goToRecent(entry);
        return (
          <MenuItem key={`recent-${entry.path}`} onClick={go} onSelected={go}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <HistoryIcon />
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0 }}>
                <span>{entry.name}</span>
                <span style={{ fontSize: 11, opacity: 0.55 }}>{shortPath(entry.path, 2)}</span>
              </span>
            </span>
          </MenuItem>
        );
      });

      const recentClearItem = (
        <MenuItem key="recent-clear" onClick={clearRecent} onSelected={clearRecent}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}><HistoryIcon />{t("recent.clear")}</span>
        </MenuItem>
      );

      const openRecentSubmenu = () => {
        // Picking a MenuItem closes its menu; let that finish before the
        // history goes up in its place.
        window.setTimeout(() => {
          contextMenuInstance.current = showContextMenu(
            <Menu label={t("menu.recent_locations")}>
              {recentItems}
              <MenuSeparator />
              {recentClearItem}
            </Menu>,
            anchor,
          );
        }, 0);
      };

      const recentLocations = !recentPaths.length ? null : SubMenu ? (
        <SubMenu key="recent-locations" label={t("menu.recent_locations")}>
          {recentItems}
          <MenuSeparator />
          {recentClearItem}
        </SubMenu>
      ) : (
        <MenuItem key="recent-locations" onClick={openRecentSubmenu} onSelected={openRecentSubmenu}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}><HistoryIcon />{t("menu.recent_locations")}</span>
        </MenuItem>
      );
      const exitApp = () => {
        // Same teardown caveat as toggleSplit: close the menu first, navigate
        // away on the next tick.
        if (contextMenuInstance.current) {
          contextMenuInstance.current.Hide();
          contextMenuInstance.current = null;
        }
        window.setTimeout(() => exitPluginRef.current(), 0);
      };

      if (item) {
        const copy = async () => {
          try {
            await copyPath(item.path);
            await refreshClipboard();
          } catch (e: any) {
            setError(e?.message ?? t("error.could_not_copy"));
          }
        };
        const cut = async () => {
          try {
            await cutPath(item.path);
            await refreshClipboard();
          } catch (e: any) {
            setError(e?.message ?? t("error.could_not_cut"));
          }
        };
        const extract = async () => {
          try {
            const res = await runOperation(t("action.extracting"), () => extractArchive(item.path, currentDir), {
              onError: (e) => handleOperationError(e, "error.could_not_extract"),
            });
            if (res && res.new_path) {
              currentPane.setFocusPath(res.new_path);
            }
          } catch (e: any) {
            setError(e?.message ?? t("error.could_not_extract"));
          }
        };
        const copyToOther = () => void handleTransferToOtherPane(item, "copy");
        const moveToOther = () => void handleTransferToOtherPane(item, "cut");
        const edit = () => {
          // The menu lives in its own React root that Steam tears down
          // synchronously on activation; opening the modal on the next tick
          // keeps the state update from being dropped mid-teardown.
          if (contextMenuInstance.current) {
            contextMenuInstance.current.Hide();
            contextMenuInstance.current = null;
          }
          window.setTimeout(() => openEditor(item), 0);
        };
        const rename = () => {
          setRenameTarget(item.path);
          setRenameValue(item.name);
          setRenameRequested(true);
        };
        const remove = () => {
          setDeleteTarget(item.path);
          setDeleteName(item.name);
          setDeleteRequested(true);
        };
        const properties = () => {
          void (async () => {
            try {
              const props = await getProperties(item.path);

              setPropertiesData(props);
              setPropertiesRequested(true);
              setIsCalculatingFolderSize(props.type === "folder");

              if (props.type === "folder") {
                getDirectorySize(item.path)
                  .then((sizeResult) => {
                    if (sizeResult.size !== null) {
                      setPropertiesData((prev) => (prev ? { ...prev, size: sizeResult.size } : prev));
                    }
                    setIsCalculatingFolderSize(false);
                  })
                  .catch(() => {
                    setIsCalculatingFolderSize(false);
                  });
              }
            } catch (e: any) {
              setError(e?.message ?? t("error.could_not_properties"));
            }
          })();
        };

        contextMenuInstance.current = showContextMenu(
          <Menu label={`${t("menu.options")} : ${item.name}`}>
            <MenuItem onClick={() => void copy()} onSelected={() => void copy()}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><CopyIcon />{t("menu.copy")}</span>
            </MenuItem>

            {clipboardHas ? <MenuItem onClick={paste} onSelected={paste}><span style={{ display: "flex", alignItems: "center", gap: 10 }}><PasteIcon />{t("menu.paste")}</span></MenuItem> : null}

            <MenuItem onClick={() => void cut()} onSelected={() => void cut()}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><CutIcon />{t("menu.cut")}</span>
            </MenuItem>

            {splitOn ? <MenuSeparator /> : null}
            {splitOn ? (
              <MenuItem onClick={copyToOther} onSelected={copyToOther}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}><CopyIcon />{t("menu.copy_to_other")}</span>
              </MenuItem>
            ) : null}
            {splitOn ? (
              <MenuItem onClick={moveToOther} onSelected={moveToOther}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}><CutIcon />{t("menu.move_to_other")}</span>
              </MenuItem>
            ) : null}
            {splitOn ? <MenuSeparator /> : null}

            {!item.is_dir ? <MenuSeparator /> : null}
            {!item.is_dir ? (
              <MenuItem onClick={edit} onSelected={edit}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}><EditIcon />{t("menu.edit")}</span>
              </MenuItem>
            ) : null}

            {isArchiveFile(item.name) ? (
              <MenuItem onClick={() => void extract()} onSelected={() => void extract()}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}><ExtractIcon />{t("menu.extract")}</span>
              </MenuItem>
            ) : null}

            <MenuItem onClick={() => setCreateFolderRequested(true)} onSelected={() => setCreateFolderRequested(true)}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><NewFolderIcon />{t("menu.newFolder")}</span>
            </MenuItem>

            <MenuItem onClick={() => setCreateFileRequested(true)} onSelected={() => setCreateFileRequested(true)}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><NewFileIcon />{t("menu.newFile")}</span>
            </MenuItem>

            <MenuItem onClick={toggleSplit} onSelected={toggleSplit}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><SplitViewIcon />{splitOn ? t("menu.split_view_close") : t("menu.split_view")}</span>
            </MenuItem>

            {recentLocations}

            <MenuSeparator />

            <MenuItem onClick={rename} onSelected={rename}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><RenameIcon />{t("menu.rename")}</span>
            </MenuItem>

            <MenuItem tone="destructive" onClick={remove} onSelected={remove}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><DeleteIcon />{t("menu.delete")}</span>
            </MenuItem>

            <MenuItem onClick={properties} onSelected={properties}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><PropertiesIcon />{t("menu.properties")}</span>
            </MenuItem>

            <MenuSeparator />

            <MenuItem onClick={exitApp} onSelected={exitApp}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><ExitIcon />{t("menu.exit")}</span>
            </MenuItem>
          </Menu>,
          anchor,
        );
      } else {
        contextMenuInstance.current = showContextMenu(
          <Menu label={t("menu.options")}>
            {clipboardHas ? <MenuItem onClick={paste} onSelected={paste}><span style={{ display: "flex", alignItems: "center", gap: 10 }}><PasteIcon />{t("menu.paste")}</span></MenuItem> : null}
            <MenuItem onClick={() => setCreateFolderRequested(true)} onSelected={() => setCreateFolderRequested(true)}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><NewFolderIcon />{t("menu.newFolder")}</span>
            </MenuItem>
            <MenuItem onClick={() => setCreateFileRequested(true)} onSelected={() => setCreateFileRequested(true)}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><NewFileIcon />{t("menu.newFile")}</span>
            </MenuItem>
            <MenuItem onClick={toggleSplit} onSelected={toggleSplit}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><SplitViewIcon />{splitOn ? t("menu.split_view_close") : t("menu.split_view")}</span>
            </MenuItem>
            {recentLocations}
            {drives.length ? <MenuSeparator /> : null}
            {drives.map((drive) => {
              const go = () => goToDrive(drive);
              return (
                <MenuItem key={drive.path} onClick={go} onSelected={go}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>{driveIconFor(drive.kind)}{driveLabelFor(drive)}</span>
                </MenuItem>
              );
            })}
            <MenuSeparator />
            <MenuItem onClick={exitApp} onSelected={exitApp}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><ExitIcon />{t("menu.exit")}</span>
            </MenuItem>
          </Menu>,
          anchor,
        );
      }
    },
    [
      clipboardHas,
      copyPath,
      cutPath,
      deletePath,
      drives,
      extractArchive,
      getDirectorySize,
      getProperties,
      goToDrive,
      handleOperationError,
      handlePaste,
      handleTransferToOtherPane,
      goToRecent,
      openEditor,
      recentPaths,
      refreshClipboard,
      refreshRecent,
      renamePath,
      runOperation,
      setError,
    ],
  );

  const getCurrentFocusedItem = useCallback(() => {
    if (typeof document === "undefined") return null;

    const active = document.activeElement as HTMLElement | null;
    if (active) {
      try {
        const row = active.closest("[data-item-path]") as HTMLElement | null;
        if (row) {
          const itemPath = row.getAttribute("data-item-path");
          const paneAttr = row.getAttribute("data-pane-index");
          const paneIndex: PaneIndex = paneAttr === "1" ? 1 : 0;
          if (itemPath) {
            const found = panesRef.current[paneIndex].itemsRef.current.find((it) => it.path === itemPath);
            if (found) return found;
          }
        }
      } catch (e) {
      }
    }

    const pane = panesRef.current[activePaneIndexRef.current];
    if (pane.focusPathRef.current) {
      const focusedItem = pane.itemsRef.current.find((it) => it.path === pane.focusPathRef.current);
      if (focusedItem) return focusedItem;
    }

    return null;
  }, []);

  useEffect(() => {
    openContextMenuRef.current = openContextMenu;
    getCurrentFocusedItemRef.current = getCurrentFocusedItem;
    goBackRef.current = goBack;
    exitPluginRef.current = exitPlugin;
    toggleDualPaneRef.current = toggleDualPane;
  }, [openContextMenu, getCurrentFocusedItem, goBack, exitPlugin, toggleDualPane]);

  const handleFooterTriangle = useCallback(() => {
    const item = getCurrentFocusedItemRef.current();
    openContextMenuRef.current(item);
  }, []);

  const handleFooterCross = useCallback(() => {
    const item = getCurrentFocusedItemRef.current();
    if (item && item.is_dir) {
      const pane = panesRef.current[activePaneIndexRef.current];
      void pane.loadPath(item.path, undefined, true, item.path);
    }
  }, []);

  const handleFooterCircle = useCallback(() => {
    goBack();
  }, [goBack]);

  const handleOpenDir = useCallback((pane: PaneApi, item: FileEntry) => {
    setActivePane(pane.index);
    if (item.is_dir) {
      void pane.loadPath(item.path, undefined, true, item.path);
      return;
    }
    // Archives have their own action in the menu; everything else opens in the
    // editor and the backend decides — refusing binaries and oversized files
    // with a message beats A silently doing nothing.
    if (!isArchiveFile(item.name)) {
      openEditor(item);
    }
  }, [setActivePane, openEditor]);

  useEffect(() => {
    isPluginActive.current = true;
    return () => {
      isPluginActive.current = false;
    };
  }, []);

  useEffect(() => {
    setError(null);
  }, [activePane.path, setError]);

  // Every navigation lands here, so this is where the history is written.
  useEffect(() => {
    if (!activePane.path) return;
    setRecentPaths(recentEntriesFrom(recordRecentPath(activePane.path)));
  }, [activePane.path]);


  const visiblePanes: PaneApi[] = dualPane ? [paneA, paneB] : [activePane];

  return (
    <>
      {!hasActiveModal ? (
        <Focusable
          style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}
          navEntryPreferPosition={NavEntryPositionPreferences.FIRST}
          onCancel={handleCancel}
          onCancelButton={handleCancel}
          onCancelActionDescription={t("action.back")}
          onOKActionDescription={t("action.select")}
          onOptionsActionDescription={t("action.options")}
        >
          <div ref={fileManagerScopeRef} data-file-manager-scope style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "100%", padding: "56px 12px 48px", boxSizing: "border-box" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "100%" }}>
              <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 10, opacity: 0.45, paddingBottom: 4 }}>
                v{packageInfo.version}
              </div>

              {editorBuffer ? (
                <EditorView
                  buffer={editorBuffer}
                  loading={editorLoading}
                  saving={editorSaving}
                  saved={editorSaved}
                  error={editorError}
                  stale={editorStale}
                  discardPrompt={editorDiscardPrompt}
                  editingLine={editingLine}
                  editingValue={editingValue}
                  editingCaret={editingCaret}
                  visibleLines={visibleLines}
                  onEditingText={setEditingText}
                  onStartLine={startEditLine}
                  onInsertText={insertText}
                  onBackspace={backspaceEditing}
                  onEnter={splitEditingLine}
                  onCaret={moveCaret}
                  onMoveLine={moveEditingLine}
                  onApplyLine={applyLineEdit}
                  onCancelLine={() => setEditingLine(null)}
                  onClearLine={() => setEditingText("", 0)}
                  onInsertLine={insertLineAfter}
                  onDeleteLine={deleteLine}
                  onShowMore={() => setVisibleLines((count) => count + 150)}
                  onSave={saveEditor}
                  onReload={reloadEditor}
                  onKeepEditing={() => setEditorDiscardPrompt(false)}
                  onDiscard={closeEditor}
                  onClose={editorBack}
                />
              ) : (
                <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {dualPane ? (
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      padding: "4px 8px",
                      borderRadius: 3,
                      background: "rgba(120,180,255,0.9)",
                      color: "#0b1622",
                    }}
                  >
                    {activePaneIndex === 0 ? t("panel.left") : t("panel.right")}
                  </span>
                ) : null}
                <div ref={pathInputScopeRef} data-path-input style={{ flex: 1, minWidth: 0 }}>
                  <TextField
                    onFocus={() => {
                      pathInputFocusedRef.current = true;
                      pathInputLastFocusRef.current = Date.now();
                      if (pathInputBlurTimerRef.current !== null) {
                        window.clearTimeout(pathInputBlurTimerRef.current);
                        pathInputBlurTimerRef.current = null;
                      }
                      stabilizePathInputFocus();
                    }}
                    onClick={stabilizePathInputFocus}
                    onBlur={() => {
                      if (pathInputBlurTimerRef.current !== null) {
                        window.clearTimeout(pathInputBlurTimerRef.current);
                      }
                      pathInputBlurTimerRef.current = window.setTimeout(() => {
                        pathInputFocusedRef.current = false;
                        pathInputBlurTimerRef.current = null;
                      }, 350);
                    }}
                    value={activePane.editedPath}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => activePane.setEditedPath(e.currentTarget.value)}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void activePane.loadPath(activePane.editedPath);
                      }
                    }}
                    bShowCopyAction={false}
                    tooltip={t("tooltip.currentPath")}
                    style={{ width: "100%", boxSizing: "border-box", minWidth: 0 }}
                  />
                </div>
              </div>

              <div style={{ width: "100%", padding: "8px 0", boxSizing: "border-box", minWidth: 0 }}>
                <Focusable
                  navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                  style={{ display: "flex", gap: "12px", width: "100%", padding: "0" }}
                >
                  <div style={{ flex: "1 1 0%", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start", padding: "0" }}>
                    <div style={{ width: "100%", minWidth: 0 }}>
                      <ToggleField
                        label={t("label.hidden")}
                        checked={showHidden}
                        onChange={(v: boolean) => setShowHidden(v)}
                      />
                    </div>
                  </div>
                  <div style={{ flex: "1 1 0%", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start", padding: "0" }}>
                    <div style={{ width: "100%", minWidth: 0 }}>
                      <ToggleField
                        label={t("label.split_view")}
                        checked={dualPane}
                        onChange={(v: boolean) => setDualPane(v)}
                      />
                    </div>
                  </div>
                  <div style={{ flex: "1 1 0%", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start", padding: "0" }}>
                    <div style={{ width: "100%", minWidth: 0 }}>
                      <DropdownItem
                        label={t("label.order")}
                        rgOptions={[
                          { label: t("option.az"), data: "asc" },
                          { label: t("option.za"), data: "desc" },
                        ]}
                        selectedOption={sortOrder}
                        onChange={(option) => setSortOrder(option.data as "asc" | "desc")}
                      />
                    </div>
                  </div>
                  <div style={{ flex: "1 1 0%", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start", padding: "0" }}>
                    <div style={{ width: "100%", minWidth: 0 }}>
                      <DropdownItem
                        label={t("label.type")}
                        rgOptions={[
                          { label: t("option.all"), data: "all" },
                          { label: t("option.folders"), data: "folders" },
                          { label: t("option.files"), data: "files" },
                        ]}
                        selectedOption={fileTypeFilter}
                        onChange={(option) => setFileTypeFilter(option.data as string)}
                      />
                    </div>
                  </div>
                </Focusable>
              </div>

              <DrivesBar drives={drives} currentPath={activePane.path} onSelect={goToDrive} />

              {error ? (
                <div
                  style={{
                    margin: "0 0 8px",
                    padding: "6px 10px",
                    borderRadius: 4,
                    fontSize: 12,
                    background: "rgba(220,80,80,0.15)",
                    border: "1px solid rgba(220,80,80,0.4)",
                  }}
                >
                  {error}
                </div>
              ) : null}

              <Focusable
                navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row", gap: 8, alignItems: "stretch" }}
              >
                {visiblePanes.map((pane) => (
                  <PaneView
                    key={pane.index}
                    pane={pane}
                    dual={dualPane}
                    active={pane.index === activePaneIndex}
                    showHidden={showHidden}
                    sortOrder={sortOrder}
                    fileTypeFilter={fileTypeFilter}
                    onPaneFocus={setActivePane}
                    onOpenDir={handleOpenDir}
                    registerContainer={registerPaneContainer}
                  />
                ))}
              </Focusable>
                </>
              )}
            </div>
          </div>
        </Focusable>
      ) : null}

      {hasActiveModal ? (
        <>
          {hasActiveModal && (
            <div
              data-modal-root
              tabIndex={-1}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.45)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                border: "1px solid rgba(255,255,255,0.08)",
                zIndex: 0,
              }}
            />
          )}

          {renameRequested && (
            <ModalRoot
              show={true}
              bDisableBackgroundDismiss={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => {
                setRenameRequested(false);
                setRenameTarget(null);
                setRenameValue("");
              }}
            >
              <DialogBody>
                <ModalFocusScope>
                  <Focusable
                    navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                    onCancel={() => { setRenameRequested(false); setRenameTarget(null); setRenameValue(""); }}
                    onCancelButton={() => { setRenameRequested(false); setRenameTarget(null); setRenameValue(""); }}
                    style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
                  >
                    <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                      <h1 style={{ margin: 0 }}>{t("modal.rename")}</h1>
                    </div>

                    <div ref={renameModalRef} style={{ padding: "6px 0" }}>
                      <TextField
                        value={renameValue}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRenameValue(e.currentTarget.value)}
                        bShowCopyAction={false}
                        autoFocus
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 16 }}>
                      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}>
                        <div style={{ width: "100%" }}>
                          <DialogButton ref={renameSaveRef as any} onClick={async () => {
                            if (!renameTarget) return;
                            if (!renameValue) return setError(t("error.invalid_name"));
                            await runOperation(t("action.renaming"), () => renamePath(renameTarget, renameValue), {
                              onError: (e) => {
                                setError(e?.message ?? t("error.could_not_rename"));
                              },
                            });
                            setRenameRequested(false);
                            setRenameTarget(null);
                            setRenameValue("");
                          }}>
                            {t("action.save")}
                          </DialogButton>
                        </div>
                      </Focusable>
                      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}>
                        <div style={{ width: "100%" }}>
                          <DialogButton onClick={() => { setRenameRequested(false); setRenameTarget(null); setRenameValue(""); }}>
                            {t("action.cancel")}
                          </DialogButton>
                        </div>
                      </Focusable>
                    </div>
                  </Focusable>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}

          {createFolderRequested && (
            <ModalRoot
              show={true}
              bDisableBackgroundDismiss={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => { setCreateFolderRequested(false); setCreateFolderName(""); }}
            >
              <DialogBody>
                <ModalFocusScope>
                  <Focusable
                    navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                    onCancel={() => { setCreateFolderRequested(false); setCreateFolderName(""); }}
                    onCancelButton={() => { setCreateFolderRequested(false); setCreateFolderName(""); }}
                    style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
                  >
                    <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                      <h1 style={{ margin: 0 }}>{t("modal.new_folder")}</h1>
                    </div>

                    <div ref={createFolderRef} style={{ padding: "6px 0" }}>
                      <TextField
                        value={createFolderName}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreateFolderName(e.currentTarget.value)}
                        bShowCopyAction={false}
                        autoFocus
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 16 }}>
                      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}>
                        <div style={{ width: "100%" }}>
                          <DialogButton ref={createFolderConfirmRef as any} onClick={async () => {
                            await handleCreateFolder(panesRef.current[activePaneIndexRef.current].pathRef.current, createFolderName);
                          }}>
                            {t("action.create")}
                          </DialogButton>
                        </div>
                      </Focusable>
                      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}>
                        <div style={{ width: "100%" }}>
                          <DialogButton onClick={() => { setCreateFolderRequested(false); setCreateFolderName(""); }}>
                            {t("action.cancel")}
                          </DialogButton>
                        </div>
                      </Focusable>
                    </div>
                  </Focusable>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}

          {createFileRequested && (
            <ModalRoot
              show={true}
              bDisableBackgroundDismiss={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => { setCreateFileRequested(false); setCreateFileName(""); }}
            >
              <DialogBody>
                <ModalFocusScope>
                  <Focusable
                    navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                    onCancel={() => { setCreateFileRequested(false); setCreateFileName(""); }}
                    onCancelButton={() => { setCreateFileRequested(false); setCreateFileName(""); }}
                    style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
                  >
                    <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                      <h1 style={{ margin: 0 }}>{t("modal.new_file")}</h1>
                    </div>

                    <div ref={createFileRef} style={{ padding: "6px 0" }}>
                      <TextField
                        value={createFileName}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreateFileName(e.currentTarget.value)}
                        bShowCopyAction={false}
                        autoFocus
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 16 }}>
                      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}>
                        <div style={{ width: "100%" }}>
                          <DialogButton ref={createFileConfirmRef as any} onClick={async () => {
                            await handleCreateFile(panesRef.current[activePaneIndexRef.current].pathRef.current, createFileName);
                          }}>
                            {t("action.create")}
                          </DialogButton>
                        </div>
                      </Focusable>
                      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}>
                        <div style={{ width: "100%" }}>
                          <DialogButton onClick={() => { setCreateFileRequested(false); setCreateFileName(""); }}>
                            {t("action.cancel")}
                          </DialogButton>
                        </div>
                      </Focusable>
                    </div>
                  </Focusable>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}

          {deleteRequested && deleteTarget && (
            <ModalRoot
              show={true}
              bDisableBackgroundDismiss={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => {
                setDeleteRequested(false);
                setDeleteTarget(null);
                setDeleteName(null);
              }}
            >
              <DialogBody>
                <ModalFocusScope>
                  <Focusable
                    navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                    onCancel={() => { setDeleteRequested(false); setDeleteTarget(null); setDeleteName(null); }}
                    onCancelButton={() => { setDeleteRequested(false); setDeleteTarget(null); setDeleteName(null); }}
                    style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
                  >
                    <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                      <h1 style={{ margin: 0 }}>{t("modal.confirm_delete")}</h1>
                    </div>
                    <div ref={deleteModalRef} style={{ padding: "6px 0", textAlign: "center" }}>
                      <div>{t("modal.delete_question").replace("{name}", String(deleteName))}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 16 }}>
                      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}>
                        <div style={{ width: "100%" }}>
                          <DialogButton ref={deleteConfirmRef as any} onClick={async () => {
                            if (!deleteTarget) return;
                            await runOperation(t("action.deleting"), () => deletePath(deleteTarget), {
                              onError: (e) => handleOperationError(e, "error.could_not_delete"),
                            });
                            setDeleteRequested(false);
                            setDeleteTarget(null);
                            setDeleteName(null);
                          }}>
                            {t("action.yes")}
                          </DialogButton>
                        </div>
                      </Focusable>
                      <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}>
                        <div style={{ width: "100%" }}>
                          <DialogButton onClick={() => { setDeleteRequested(false); setDeleteTarget(null); setDeleteName(null); }}>
                            {t("action.no")}
                          </DialogButton>
                        </div>
                      </Focusable>
                    </div>
                  </Focusable>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}

          {conflictModal && (
            <ModalRoot
              show={true}
              bDisableBackgroundDismiss={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => setConflictModal(null)}
            >
              <DialogBody>
                <ModalFocusScope>
                  <Focusable
                    navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                    onCancel={() => setConflictModal(null)}
                    onCancelButton={() => setConflictModal(null)}
                    style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
                  >
                    <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                      <h1 style={{ margin: 0 }}>{conflictModal.title}</h1>
                    </div>
                    <div style={{ padding: "6px 0", textAlign: "center" }}>
                      <div>{conflictModal.message}</div>
                      <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>{conflictModal.targetDir}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 16 }}>
                      {conflictModal.isFolderConflict ? (
                        <>
                          <DialogButton ref={conflictPrimaryRef as any} onClick={() => void handleConflictChoice("merge")}>{t("conflict.merge")}</DialogButton>
                          <DialogButton onClick={() => void handleConflictChoice("replace")} >{t("conflict.replace")}</DialogButton>
                          <DialogButton onClick={() => void handleConflictChoice("ignore")} >{t("conflict.ignore")}</DialogButton>
                          <DialogButton onClick={() => setConflictModal(null)}>{t("action.cancel")}</DialogButton>
                        </>
                      ) : (
                        <>
                          <DialogButton ref={conflictPrimaryRef as any} onClick={() => void handleConflictChoice("replace")}>{t("conflict.replace")}</DialogButton>
                          <DialogButton onClick={() => void handleConflictChoice("keep-both")}>{t("conflict.keep_both")}</DialogButton>
                          <DialogButton onClick={() => void handleConflictChoice("ignore")}>{t("conflict.ignore")}</DialogButton>
                          <DialogButton onClick={() => setConflictModal(null)}>{t("action.cancel")}</DialogButton>
                        </>
                      )}
                    </div>
                  </Focusable>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}

          {permissionModal && (
            <ModalRoot
              show={true}
              bDisableBackgroundDismiss={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => setPermissionModal(null)}
            >
              <DialogBody>
                <ModalFocusScope>
                  <Focusable
                    navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
                    onCancel={() => setPermissionModal(null)}
                    onCancelButton={() => setPermissionModal(null)}
                    style={{ outline: "none", display: "flex", flexDirection: "column", alignItems: "stretch" }}
                  >
                    <div style={{ textAlign: "center", padding: "6px 0 12px" }}>
                      <h1 style={{ margin: 0 }}>{t("modal.permission_denied")}</h1>
                    </div>
                    <div style={{ padding: "6px 0", textAlign: "center" }}>
                      <div>{permissionModal.message}</div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                      <DialogButton ref={permissionPrimaryRef as any} onClick={() => setPermissionModal(null)}>{t("action.cancel")}</DialogButton>
                    </div>
                  </Focusable>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}

          {operationModal && (
            <ModalRoot
              show={true}
              bDisableBackgroundDismiss={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => setOperationCancelRequested(true)}
            >
              <DialogBody>
                <ModalFocusScope>
                  <div style={{ minWidth: 280, padding: "8px 0" }}>
                    <div style={{ textAlign: "center", marginBottom: 8 }}>
                      <strong>{operationModal.label}</strong>
                    </div>
                    <div style={{ height: 12, borderRadius: 999, background: "#2b2b2b", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${operationModal.progress}%`, background: "#4e8ad9", transition: "width 0.2s linear" }} />
                    </div>
                    <div style={{ textAlign: "center", marginTop: 8, fontSize: 12 }}>{operationModal.progress}%</div>
                    <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                      <DialogButton onClick={() => setOperationCancelRequested(true)}>
                        {t("action.cancel")}
                      </DialogButton>
                    </div>
                  </div>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}

          {propertiesRequested && propertiesData && (
            <ModalRoot
              show={true}
              bHideMainWindowForPopouts={true}
              onCancel={() => {
                setPropertiesRequested(false);
                setPropertiesData(null);
                setIsCalculatingFolderSize(false);
              }}
            >
              <DialogBody>
                <ModalFocusScope>
                  <div style={{ textAlign: "center", paddingBottom: 8 }}>
                    <h1 style={{ margin: 0 }}>{t("menu.properties")}</h1>
                  </div>
                  <Focusable
                    onCancel={() => {setPropertiesRequested(false);setPropertiesData(null);setIsCalculatingFolderSize(false);
                    }}
                  onCancelButton={() => {setPropertiesRequested(false);setPropertiesData(null);setIsCalculatingFolderSize(false);
                    }}
                    style={{ outline: "none" }}
                  >
                    <div ref={propertiesModalRef} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div><strong>{t("properties.name")}</strong> {propertiesData.name}</div>
                      <div><strong>{t("properties.path")}</strong> {propertiesData.path}</div>
                      <div><strong>{t("properties.type")}</strong> {propertiesData.type === "folder" ? t("properties.type.folder") : t("properties.type.file")}</div>
                      <div><strong>{t("properties.size")}</strong> {propertiesData.type === "folder" && isCalculatingFolderSize
                        ? t("properties.calculating")
                        : propertiesData.size !== null
                          ? formatBytes(propertiesData.size)
                          : "N/A"}</div>
                      <div><strong>{t("properties.created")}</strong> {propertiesData.created}</div>
                      <div><strong>{t("properties.modified")}</strong> {propertiesData.modified}</div>
                      <div><strong>{t("properties.permissions")}</strong> {propertiesData.permissions}</div>
                    </div>
                    <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 12 }}>
                      <DialogButton ref={propertiesCloseRef as any} onClick={() => { setPropertiesRequested(false); setPropertiesData(null); setIsCalculatingFolderSize(false); }}>
                        {t("action.close")}
                      </DialogButton>
                    </div>
                  </Focusable>
                </ModalFocusScope>
              </DialogBody>
            </ModalRoot>
          )}
        </>
      ) : null}

      {exitHoldActive ? (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 76,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minWidth: 220,
              padding: "10px 16px",
              borderRadius: 6,
              background: "rgba(10,16,24,0.92)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
            }}
          >
            <span style={{ fontSize: 12, letterSpacing: 0.3, textAlign: "center", opacity: 0.9 }}>{t("exit.holding")}</span>
            <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: exitHoldFilled ? "100%" : "0%",
                  background: "rgba(120,180,255,0.95)",
                  transition: `width ${EXIT_HOLD_MS}ms linear`,
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          paddingLeft: 24,
          paddingRight: 24,
          pointerEvents: "none",
          zIndex: 999,
        }}
      >
        {!hasActiveModal ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11, opacity: 0.55, whiteSpace: "nowrap", overflow: "hidden" }}>
            <span>{`X · ${dualPane ? t("hint.split_close") : t("hint.split_open")}`}</span>
            {dualPane ? <span>{`L1 / R1 · ${t("hint.switch_panel")}`}</span> : null}
            <span>{t("hint.hold_exit")}</span>
          </div>
        ) : <div />}

        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 80,
              height: 60,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              pointerEvents: "auto",
            }}
            onClick={handleFooterCircle}
          />

          <div
            style={{
              width: 80,
              height: 60,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              pointerEvents: "auto",
            }}
            onClick={handleFooterTriangle}
          />

          <div
            style={{
              width: 80,
              height: 60,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              pointerEvents: "auto",
            }}
            onClick={handleFooterCross}
          />
        </div>
      </div>
    </>
  );
}

function Content() {
  const openFullScreen = useCallback(() => {
    Router.CloseSideMenus();
    Router.Navigate?.("/decky-file-manager");
  }, []);

  return (
    <PanelSection title={t("panel.file_manager")}>
      <PanelSectionRow>
        <ButtonItem
          onClick={openFullScreen}
          layout="below"
        >
          <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 10 }}>
            <PluginIcon />
            <span>{t("action.open_file_manager")}</span>
          </div>
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

routerHook.addRoute("/decky-file-manager", FileManagerPage);

export default definePlugin(() => {
  return {
    name: "Decky File Manager",
    content: <Content />,
    icon: <PluginIcon />,
  };
});
