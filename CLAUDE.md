# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Decky Loader plugin (Decky API v2) that adds a controller-driven file manager to SteamOS Gaming Mode. It has two halves that talk over Decky's RPC bridge:

- [main.py](main.py) — the Python backend, a single `Plugin` class. Every public `async def` on it is an RPC endpoint.
- [src/index.tsx](src/index.tsx) — the entire React frontend (~2400 lines): quick-access panel entry, full-screen file browser route, all modals, and controller input handling.

## Commands

```bash
pnpm install          # pnpm is required (pnpm-lock.yaml; peerDependencyRules ignore react/react-dom)
pnpm run build        # rollup -c -> dist/index.js
pnpm run watch        # rebuild on change
pnpm run package      # build + zip to decky-file-manager.zip (installable via Decky's "Install from zip")
pnpm run auto-package # rebuild + repackage on every src/** change
```

There is no test suite and no linter — `pnpm test` intentionally exits 1. Type errors surface only through `pnpm run build` (tsconfig is `strict`, plus `noUnusedLocals`/`noUnusedParameters`, so unused variables break the build; the codebase uses `void someVar;` to silence intentional ones).

Verifying behavior requires an actual Steam Deck / SteamOS or Bazzite device with Decky Loader — the plugin depends on `window.SteamClient` and Decky's runtime directories, neither of which exist off-device.

## Backend / frontend contract

`callable<[args], ReturnShape>("method_name")` in the frontend maps 1:1 to `Plugin.method_name` in `main.py`. Adding a backend method means adding the matching `callable` declaration — most are declared inside `FileManagerPage`, with `list_dir` at module scope.

Two conventions that are easy to break:

- **Backend exception messages are in Portuguese, and the frontend string-matches them.** Several handlers do `message.toLowerCase().includes("permissão")` to decide whether to show the permission-denied modal instead of an inline error. Changing a backend error string to English silently downgrades that UX. Everything user-facing goes through `t()`; raw exception text is only a fallback.
- **Split view is two independent `usePane` instances.** `FileManagerPage` holds `paneA`/`paneB` plus `activePaneIndex`; in single-panel mode only the active pane is rendered, so collapsing the split keeps whatever you were looking at. `panesRef` mirrors both panes so the controller handler and context menu can read current state without stale closures. `usePane` objects are recreated every render — never put one in an effect dependency array.
- **`transfer_path` / `check_transfer_conflict`** are the split-view copy/move: they take an explicit source and destination and deliberately do *not* touch the cut/copy clipboard, unlike the `paste_*` family.
- **Several endpoints exist twice** (`rename_path`/`rename_item`, `delete_path`/`delete_item`, `paste_path`/`paste_path_with_options`, `get_properties`/`get_properties_item`, `has_clipboard`/`get_clipboard_kind`/`copy_or_cut_status`/`get_clipboard_info`). The `_item`/`_with_options` variants are what the frontend actually calls; the others are thin aliases.

## Backend state and safety

State lives in the `Plugin` instance and is mirrored to disk so it survives a plugin reload:

- `DECKY_PLUGIN_SETTINGS_DIR/settings.json` — `default_path` (defaults to `/home/deck`).
- `DECKY_PLUGIN_RUNTIME_DIR/runtime.json` — the cut/copy clipboard (`path` + `kind`) and `last_path`. On load, a clipboard entry pointing at a missing path is discarded.

An empty `path` argument is not an error: `_normalize_dir` falls back to `last_path`, then to `default_path`.

Path safety is centralized in helpers that must be kept in the flow for any new destructive operation:

- `_is_subpath` / `_is_self_or_subdirectory` / `_is_safe_target_for_path` — block pasting a directory into itself or a descendant.
- `_safe_archive_member_path` — rejects absolute and traversal entries; `_safe_extract_zip` / `_safe_extract_tar` extract member-by-member through it rather than calling `extractall`.
- `_unique_target_path` — the `keep-both` conflict strategy (`name (1).ext`).

Paste is a two-step protocol: the frontend calls `check_paste_conflict` first, shows the conflict modal if `needs_conflict`, then calls `paste_path_with_options` with one of `merge` / `replace` / `ignore` / `keep-both` / `cancel`. Directory size calculation (`get_directory_size`) is offloaded with `asyncio.to_thread` since it walks the tree.

Note the plugin runs with `"flags": []` in [plugin.json](plugin.json) — no root. Permission errors on system paths are expected and are surfaced as a modal, not a crash.

## Frontend structure

Everything is one file. The pieces worth knowing before editing:

- `definePlugin` returns only the small `Content()` panel; the real UI is a route registered via `routerHook.addRoute("/decky-file-manager", FileManagerPage)` at module scope, and the panel button navigates to it.
- **Controller input** is handled by `SteamClient.Input.RegisterForControllerInputMessages`, keyed on raw button indices (B = 1, X = 2, Y = 3, L1 = 30, R1 = 31 — the full enum is `ControllerInputGamepadButton` in `@decky/ui`). X toggles the split; L1/R1 move focus to the left/right panel, and R1 opens the split when it is closed. B is context-sensitive: it blurs the path input, dismisses an open modal/context menu, or navigates up a directory — and a hold of `EXIT_HOLD_MS` (800ms) exits the plugin, with a progress overlay driven by `beginExitHold`/`endExitHold` (the Y menu carries an `Exit file manager` entry as the non-hold path). Because Decky's context menus don't expose a close API, dismissal falls back to DOM probing (`.contextMenu`, `[role='menu']`, synthetic `Escape` events, text-matching a cancel button). This is deliberately defensive; changes here need on-device testing.
- **`ModalFocusScope`** traps focus for every modal: it marks the browser container (`[data-file-manager-scope]`) `inert` + `aria-hidden`, remaps arrow keys and Tab onto the focusable list, and restores focus on unmount. Any new modal should be wrapped in it, or the D-pad will escape into the list behind it.
- The list renders `filteredItems.slice(0, visibleItemCount)` starting at 150 entries with a "Show more" button — there is no virtualization, so large directories rely on this cap. Filtering/sorting and the item cap live in `PaneView`; hidden/sort/type settings are shared by both panels.
- The **drives bar** comes from `list_drives`, which parses `/proc/mounts`, drops pseudo filesystems and OS mount points, and classifies each volume (`sdcard`/`usb`/`internal`) from `/sys/class/block/*/removable`. Unlabelled volumes come back named after their device node, so `driveLabelFor` substitutes a generic per-kind label.

## i18n

`t(key)` reads from a translation table **hardcoded inside [src/i18n.ts](src/i18n.ts)** (en, pt-BR, es, zh-CN, fr, de). The [locales/](locales/) JSON files are a separate runtime-overlay path: `loadRemoteTranslations` fetches `./locales/<locale>.json` (then any `translations_base_url` from plugin.json, then a raw GitHub URL) and caches the result in `localStorage` for 24h.

**Adding or changing a string means editing both `src/i18n.ts` and every file in `locales/`** — the bundled table is the fallback, the JSON is what actually ships to users after the overlay loads. Locale is inferred from `SteamClient` with a `navigator.language` fallback and normalized to those six keys. Interpolation is plain `.replace("{name}", …)`.

## Naming

The plugin is called **Decky File Manager** everywhere, and the pieces have to agree:

| Where | Value |
| --- | --- |
| repo | `Decky-File-Manager` |
| `plugin.json` `name` | `Decky File Manager` — Decky's install directory |
| folder inside the zip | `Decky File Manager` — **must match `plugin.json`** |
| `definePlugin` `name` | `Decky File Manager` |
| npm package / zip file | `decky-file-manager` (npm names cannot contain spaces or capitals) |
| route | `/decky-file-manager` |

The zip's inner folder is the load-bearing one. If it differs from `plugin.json`'s `name`, installing produces a *second* plugin directory alongside the existing install, both declaring the same plugin name — Decky then loads whichever it finds first and the new build silently never runs. Keep the two in sync when touching the `package` script.

Renaming leaves the previous install behind under its old directory name; it has to be deleted from `~/homebrew/plugins/` by hand.
