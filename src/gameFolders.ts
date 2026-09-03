/**
 * Opening the file manager at one of a Steam game's folders.
 *
 * The request comes from the game's context menu in the library, which is not
 * inside the page's React tree, so it cannot be handed over as a prop. It also
 * cannot travel as a query string on the route: the Steam client's router does
 * not put the query anywhere `window.location` can be read for it, so the page
 * would come up with no request at all. It travels in this module instead,
 * which both sides import.
 */
import { Navigation } from "@decky/ui";

export const ROUTE = "/decky-file-manager";

/** Which of the game's folders was asked for. */
export type BrowseKind = "install" | "compat";

export interface BrowseRequest {
  /** Steam's app id. The folders themselves are looked up on the backend. */
  appid: string;
  kind: BrowseKind;
}

type Listener = (request: BrowseRequest) => void;

/** Set before navigating, taken by the page when it mounts. */
let pending: BrowseRequest | null = null;
const listeners = new Set<Listener>();

/** Navigate to the full page and open it at the folder asked for. */
export function openGameFolder(request: BrowseRequest): void {
  const copy = { ...request };
  pending = copy;
  Navigation.Navigate(ROUTE);
  Navigation.CloseSideMenus();

  // The page may already be up — the Quick Access panel and the library menu
  // both reach it — in which case nothing mounts. Delivering it live also
  // clears the pending copy, which would otherwise be answered late, the next
  // time the page is opened for something else entirely.
  if (listeners.size > 0) {
    pending = null;
    for (const listener of listeners) listener(copy);
  }
}

/** Whether a request is waiting, without consuming it. */
export function hasPendingBrowse(): boolean {
  return pending !== null;
}

/** The request the page was opened with, consumed once. */
export function takePendingBrowse(): BrowseRequest | null {
  const request = pending;
  pending = null;
  return request;
}

/** Called when a folder is asked for while the page is already open. */
export function subscribeBrowse(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
