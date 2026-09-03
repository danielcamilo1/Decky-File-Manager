/**
 * Steam's own submenu component, found by searching its bundle rather than
 * imported, so it can come back undefined if Valve moves it. Rendering
 * undefined would take the whole menu down with it, so every use is guarded
 * and falls back to something flat.
 */
import { MenuGroup } from "@decky/ui";
import type { FC, ReactNode } from "react";

export const SubMenu = MenuGroup as unknown as FC<{ label: string; children?: ReactNode }> | undefined;
