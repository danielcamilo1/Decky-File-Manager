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
- **`get_transfer_progress` / `cancel_transfer`** are polled and called by the progress modal while a copy runs; see *Copy progress* below.
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

### Copy progress

Copying does **not** go through `shutil.copytree`/`copy2` any more: a call that only returns once it has finished has nothing to report on the way. `_copy_path` walks the tree itself (`_copy_tree_tracked` → `_copy_file_tracked`, `_COPY_CHUNK` = 4 MiB) and updates a counter dict as it goes. Three things hang off that:

- **Threading.** `_run_tracked(kind, source, work, measure)` measures the source with `_measure_source` and then runs the copy inside `asyncio.to_thread`, so the event loop stays free to answer `get_transfer_progress` mid-copy — the entire point. The copy thread writes `self._progress` and the endpoint reads it, both under `self._progress_lock`. `_measure_source` is best effort and never raises: it only feeds the bar, and an unreadable entry must not fail an operation that has not started. Both it and the copy visit a directory once per real path, so a symlink loop terminates (`shutil.copytree` would not).
- **A same-filesystem move is a rename**, so `_same_filesystem` skips both the measuring and the progress (`measure=False`); the frontend then falls back to the old indeterminate bar, which is what `total_bytes == 0` means to it.
- **Cancellation is real.** `cancel_transfer` sets a `threading.Event` that both loops check; `_CopyCancelled` unwinds the thread, `_run_tracked` returns `True`, and the endpoint answers `{"ok": True, "cancelled": True}` **without clearing the clipboard** — a paste that did not happen should still be pasteable. The half-written destination *file* is removed; files that completed before the cancel are left where they are, and a cancelled `cut` has not deleted anything, because the source removal only happens after the copy returns. **`replace` no longer deletes first**: the copy lands on a `_unique_target_path` beside the old item and only takes its place (`_remove_path` + `os.replace`) once it is complete, with `_discard_partial` taking the temporary copy back if anything — a cancel included — goes wrong. Without that, cancelling a replace would leave neither the old item nor a whole new one.

`get_transfer_progress` answers `{active, counting, kind, name, current, total_files, copied_files, total_bytes, copied_bytes, elapsed}`. It reports raw counters and lets the frontend derive speed from the difference between two polls — that is also what gives the graph its samples. Nothing else in the plugin (delete, extract) is tracked; those keep the placeholder bar. A finished `paste_path_with_options` / `transfer_path` also answers with `kind` (`copy` or `move`), which is only there so the frontend can name the operation in its confirmation — by the time a paste returns, the clipboard it could have asked has been cleared.

## Privileges

[plugin.json](plugin.json) declares `"flags": ["root"]`, so Decky (itself root) starts the backend as root — **and `main.py` gives root away at import time, before `Plugin` is ever constructed.** The whole dance lives at the top of the file and must stay there:

1. `_decky_user()` finds the real user. `USER`/`HOME` describe the *process* and say `root` under this flag; `DECKY_USER`/`DECKY_USER_HOME` keep naming the person, with the owner of `DECKY_PLUGIN_DIR` as a fallback.
2. `_spawn_root_helper()` forks **before** the drop. The child is the only thing that keeps root; it understands exactly two words on a pipe — `install` and `remove` — takes no arguments, writes or deletes only `_POLKIT_RULE_PATH`, and exits when the pipe closes (i.e. when the plugin does). `_ask_root_helper` is the parent's side, with a 20s `select` timeout.
3. `_chown_decky_dirs()` hands the settings/runtime/log directories back to the user — Decky creates them root-owned for a root plugin, and every later write happens after the drop.
4. `os.initgroups` + `os.setgid` + `os.setresuid(uid, uid, uid)` — real, effective *and* saved, so there is no way back.

Everything else — every copy, delete, rename, extract and editor save — therefore runs as the user, exactly as it did before the flag. **Do not add privileged work outside the helper**, and do not widen the helper's vocabulary: a file manager on a controller must not be able to write to `/usr` because a thumbstick moved. Permission errors on system paths are still expected and are surfaced as a modal, not a crash.

`get_mount_permission` / `install_mount_permission` / `remove_mount_permission` are the endpoints around the helper (`can_install` is just `_ROOT_HELPER is not None`). Started without the flag, `_prepare_privileges()` returns `None`, no helper exists, and the UI falls back to the `prepare_mount_permission` script.

## Frontend structure

Everything is one file. The pieces worth knowing before editing:

- `definePlugin` returns only the small `Content()` panel; the real UI is a route registered via `routerHook.addRoute("/decky-file-manager", FileManagerPage)` at module scope, and the panel button navigates to it.
- **Controller input** is handled by `SteamClient.Input.RegisterForControllerInputMessages`, keyed on raw button indices (B = 1, X = 2, Y = 3, L1 = 30, R1 = 31 — the full enum is `ControllerInputGamepadButton` in `@decky/ui`). X toggles the split; L1/R1 move focus to the left/right panel, and R1 opens the split when it is closed. B is context-sensitive: it blurs the path input, dismisses an open modal/context menu, or navigates up a directory — and a hold of `EXIT_HOLD_MS` (800ms) exits the plugin, with a progress overlay driven by `beginExitHold`/`endExitHold` (the Y menu carries an `Exit file manager` entry as the non-hold path). Because Decky's context menus don't expose a close API, dismissal falls back to DOM probing (`.contextMenu`, `[role='menu']`, synthetic `Escape` events, text-matching a cancel button). This is deliberately defensive; changes here need on-device testing.
- The **progress modal** is `OperationProgress` plus `SpeedGraph`, both at module scope. `runOperation(label, action, { tracked: true })` is what turns a copy into a live one: it polls `get_transfer_progress` every `PROGRESS_POLL_MS` (350ms), derives speed from the byte delta between polls, keeps the last `SPEED_SAMPLES` (48) of them for the graph and an EMA for the figure on screen (raw samples in the graph, so a stall reads as a dip; smoothed number above it, so it can be read at all). Only the four paste/transfer call sites pass `tracked`, and a tracked operation deliberately does **not** run the +7%-every-160ms placeholder bar the others still use: it would climb while the source was being measured and then have to jump backwards to the real figure. `OperationProgress` shows the graph and the counts only once `counting` is over or `totalBytes > 0`, so an unmeasured copy (the instant move) simply shows the plain bar. `SpeedGraph` is a hand-rolled SVG sparkline with `preserveAspectRatio="none"`, so every stroke needs `vectorEffect="non-scaling-stroke"` and nothing round can go in it. Cancel is honest now: `requestOperationCancel` calls `cancel_transfer` and sets `operationCancelRef` — a **ref**, because the running `runOperation` closed over the old state value and could never see the update.
- **How an operation ends.** The modal does not simply vanish: on success `runOperation` sets `done` on the modal state, which turns `OperationProgress` green, replaces the label with a ✓ and `progress.complete`, and drops everything that only makes sense while it is running (files left, ETA, the current file). It holds that for 900ms on a tracked operation and 320ms otherwise, and the close is `setOperationModal((prev) => prev && prev.done ? null : prev)` so a later operation's modal cannot be taken down by an earlier one's timer. A tracked operation also leaves a green `showNotice` summary behind it — `notice.copy_done_detail` / `notice.move_done_detail`, size and elapsed time, falling back to the plain `notice.copy_done` / `notice.move_done` when there was nothing to measure. Which of the two it says comes from the `kind` field `paste_path_with_options` and `transfer_path` return (`copy` or `move`); the frontend cannot work it out for a paste, because the clipboard has been cleared by then. Success also calls `setError(null)`: the guard at the top of `runOperation` answers a second, racing call with `action.another_running`, and a red line set while the modal was up would otherwise be sitting there when it closed — which is exactly what it looked like from the outside, an error at the end of a copy that had worked. `operationDoneRef` makes **B** during that last beat a dismissal rather than a cancel.
- **`ModalFocusScope`** traps focus for every modal: it marks the browser container (`[data-file-manager-scope]`) `inert` + `aria-hidden`, remaps arrow keys and Tab onto the focusable list, and restores focus on unmount. Any new modal should be wrapped in it, or the D-pad will escape into the list behind it.
- The list renders `filteredItems.slice(0, visibleItemCount)` starting at 150 entries with a "Show more" button — there is no virtualization, so large directories rely on this cap. Filtering/sorting and the item cap live in `PaneView`; hidden/sort/type settings are shared by both panels.
- The **drives bar** comes from `list_drives`, which parses `/proc/mounts`, drops pseudo filesystems and OS mount points, and classifies each volume (`sdcard`/`usb`/`internal`) from the bus its sysfs device path hangs off (`_sysfs_bus`), falling back to `/sys/class/block/*/removable`. Unlabelled volumes come back named after their device node, so `driveLabelFor` substitutes a generic per-kind label. Every entry carries an `id` (the filesystem UUID where udev has one, else the device node) and a `system` flag — set for anything on a disk that carries `/`, `/var`, `/home` and friends (`_system_disks`, which is also what stops an eMMC Deck's internal `mmcblk0` from passing for an SD card), or whose GPT partition type is EFI/MSR/recovery/swap. `list_drives` returns those too: the bar and the **Y** menu draw `visibleDrives`, filtered by `isDriveShown`, while **Manage drives** shows the unfiltered list so a hidden volume can be turned back on. Only departures from the default are stored, as `id → shown` under `decky-file-manager:drive-visibility` in `localStorage`, so a later change to what counts as a system volume still takes effect for drives the user never had an opinion about.
- `list_drives` also returns volumes that are plugged in but **not mounted** (`mounted: false`, empty `path`), found by `_collect_unmounted_drives` walking `/sys/class/block` and reading the filesystem type and label out of udev's own database at `/run/udev/data/b<major>:<minor>`. A volume qualifies when it is on the USB bus, is an SD card, or the kernel calls it removable — **not** by `removable` alone, which means "removable *media*" and reads `0` for USB-C SSDs and most large USB disks, the exact drives people plug in. Internal NVMe/SATA partitions are still excluded, which is what keeps idle rootfs slots out of the bar — an unmounted volume cannot be probed without root, and this avoids shelling out to `lsblk` on every poll. The bar polls `list_drives` every `DRIVE_POLL_MS` (5s) and keeps the previous array when the answer is byte-identical, so a plugged-in drive appears on its own without re-rendering the bar constantly. Selecting an unmounted chip calls `mount_drive`, which tries `udisksctl`, then (for NTFS) `udisksctl -t ntfs3`/`-t ntfs-3g` and `ntfs-3g` itself with `remove_hiberfile,recover` for a volume Windows left dirty, then `systemd-mount`, then `mount(8)` into a directory it creates itself, and reads back `/proc/mounts` to see which one worked. Every helper is looked up with `_resolve_binary` first (`shutil.which`, then `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/usr/local/bin`) — a plugin does not inherit a login shell's `PATH`, and a helper that is merely unreachable must not read as one that refused silently. **`mount_drive` and `unmount_drive` do not raise for an expected failure**; they answer `{success, path, reason, detail, attempts}`, where `reason` is `ok`/`already`/`denied`/`failed`/`no_tools`/`invalid`/`missing`, `attempts` is every `{tool, message}` in order (a helper that was not found says `not installed`), and `detail` joins the first three distinct ones (`_summarize_output` strips the D-Bus wrapper off udisks' answer). This is deliberate: an exception only reaches the frontend as whatever the RPC bridge makes of it, which is not reliably a `.message`, and a mount that fails with nothing to say for itself cannot be diagnosed off-device. `deviceResultMessage` renders the localized sentence with `detail` in parentheses; `deviceErrorMessage` is the fallback for a genuinely thrown error and reads an `Error`, a bare string or a response object. The `detail` text stays untranslated on purpose — "Not authorized to perform operation" and "volume is hibernated" are what has to be searched for. Helpers are spawned through `_clean_env()`, which strips the `LD_LIBRARY_PATH` Decky's PyInstaller bundle exports (restoring `*_ORIG` where it kept the real value) — without it a spawned `systemd-mount` links against Decky's bundled OpenSSL and dies in the linker instead of answering about the drive. The mount ladder runs **as the user** (see Privileges above), so udisks2 is the only helper that can succeed — and udisks grants `filesystem-mount` to an **active login session**, which a Decky plugin does not have, so a stock install answers `Not authorized to perform operation`. That is what the polkit rule fixes, and why mounting goes on working through udisks (proper mount point, proper ownership) instead of the plugin mounting things itself as root. On `reason: "denied"` the frontend opens the permission modal: with the helper present it offers **Allow mounting** (`install_mount_permission`, then it retries the drive the person actually pressed); without it, `prepare_mount_permission` writes `~/decky-file-manager-enable-mounting.sh` and the modal shows the `sudo` command. Either way the rule is written only after an explicit choice, never on the user's behalf, and **Revoke mount permission** in the Manage drives footer takes it back. `unmount_drive` is the mirror image, same result shape, and `eject_drive` is what the **Eject drive** entry in the **Y** menu actually calls: a safe removal is `_eject_target`, which unmounts **every** mounted partition of the same physical disk (`_mounted_partitions`, keyed on `_parent_disk`) and only then asks `udisksctl power-off` to cut power to the drive. The power-off is deliberately best effort — `success` follows the unmount and the extra `powered_off` field says whether the drive actually went quiet, because a drive that will not power down has still been flushed and is still safe to pull out. The menu lists one entry per mounted removable volume rather than only the one the panel is inside (a stick you are done with is usually not the folder you are looking at), and a successful eject shows a green notice, the one place in the UI where a confirmation matters more than an error would.

Powering a drive down needs `org.freedesktop.udisks2.power-off-drive`, so the polkit rule covers it (and `eject-media`) alongside the mount actions. A rule installed by an older version predates those lines, and the person would have no reason to press **Allow mounting** again — so `_refresh_mount_permission`, called from `_main`, rewrites a rule **that is already installed** when its text differs from `_polkit_rule_text(user)`. It never installs one that is not there: consent is still a button press, only its contents are kept current.

## i18n

`t(key)` reads from a translation table **hardcoded inside [src/i18n.ts](src/i18n.ts)** (en, pt-BR, es, zh-CN, fr, de; 189 keys each, and the six blocks must agree). The [locales/](locales/) JSON files are a separate runtime-overlay path: `loadRemoteTranslations` fetches `./locales/<locale>.json` (then any `translations_base_url` from plugin.json, then a raw GitHub URL) and caches the result in `localStorage` for 24h.

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
