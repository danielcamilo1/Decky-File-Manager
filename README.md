# Decky File Manager

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/danielcamilo)

> This is a fork of [Ciphay/Decky-File-Manager](https://github.com/Ciphay/Decky-File-Manager), continuing the original plugin with additional features. All credit for the original work goes to [Ciphay](https://github.com/Ciphay).

Decky File Manager is a native file manager plugin for SteamOS Gaming Mode, designed to provide a seamless and controller-friendly experience directly within the Steam interface.

Manage your files and folders without leaving Gaming Mode. Browse directories, copy, move, rename, and delete files using an intuitive interface inspired by SteamOS, making file management feel like a natural part of the console experience.

### Interface

<img width="800" height="450" alt="Interface" src="https://github.com/user-attachments/assets/291c02ae-88ca-4778-b554-280446d8e862" />


### Context Menu

<img width="800" height="450" alt="Context Menu" src="https://github.com/user-attachments/assets/e456b581-5d85-4a98-95f9-4cddf0a2d3de" />


### Navigation

<img width="800" height="450" alt="Navigation" src="https://github.com/user-attachments/assets/5280ba95-df8e-419f-b7ca-74c60973c41e" />


### Features

* Native Gaming Mode integration.
* Full controller navigation support.
* **Dual-panel (split) view** — browse two folders side by side.
* **List and grid views**, with your view, sorting and filter choices remembered between sessions.
* **Copy and move directly between panels**, the way desktop file managers work.
* **Quick access to connected drives** — SD card, USB sticks and external drives.
* **Built-in text editor** — read a file whole and edit it line by line with the SteamOS keyboard, without leaving Gaming Mode.
* **Recent folders** — jump straight back to the last folders you visited.
* **Browse a game's files from its own Steam menu** — installation folder or Proton compatdata, in one pick. Non-Steam shortcuts included.
* File and folder management.
* Copy, move, rename, and delete operations.
* Archive extraction (zip, tar and variants).
* Multi-language support.
* Designed for SteamOS and Bazzite.
* Lightweight and easy to use.
* SteamOS-inspired user interface.

## Views

The file list can be read two ways, and the choice sticks:

* **List** is the default — one entry per row, with the full name on show.
* **Grid** lays the folder out as tiles, so a folder of many short names fits on one screen instead of several. The D-pad moves between tiles in every direction, the tile under the cursor is filled and raised so there is no hunting for the selection on a TV, and it drops its name clamp so a long filename can still be read in full.
* Both panels of the split view share the view, and the tiles shrink to suit.

**Hidden files**, **order**, **type filter**, **view** and the **split** itself are remembered, so the plugin opens the way you left it rather than back at the defaults every time.

Opening a folder — or turning hidden files on — always puts you back at the top of the list, instead of leaving the first entries above the fold.

## Split view

Open a second panel and work between two folders at once, instead of copying something, navigating away, and pasting.

* Press **X**, or use the **Split** toggle in the toolbar, to open and close the split.
* Press **L1** / **R1** to move between the left and right panel. The **D-pad** also crosses between them at the edge of a list.
* The active panel is highlighted, and the path field and every action follow it — so there is never any doubt about which side you are working on.
* Opening the split clones the current folder into the new panel once; after that each panel keeps its own location.

With the split open, the **Y** options menu gains **Copy to other panel** and **Move to other panel**, which transfer straight to the other side without touching the clipboard.

## Text editor

Text files open in an editor right inside the plugin, so a config tweak no longer means a trip to Desktop Mode.

* Press **A** on a text file to open it, or pick **Edit file** from the **Y** options menu for any file.
* The editor opens in place of the file list, so it is navigable with the D-pad like the rest of the plugin.
* **The whole file is on screen**, as numbered lines at the text's own height rather than a form of one control per line. The D-pad walks down it, and the line under the cursor un-truncates so a long line can be read in full.
* Press **A** on a line to edit it. A field opens underneath — Steam's own, so the SteamOS keyboard comes up — and it is focused straight away.
* **The file stays visible while you type**, with the line being edited marked in place and updating as you go.
* **▲** and **▼** carry the field to the line above or below without closing it, so a run of edits is one session rather than one round trip per line. The file scrolls to follow.
* **Split here** breaks the line at the cursor, and **Insert line**, **Delete line** and **Clear** sit beside it.
* **B** applies the line and returns to the file, so nothing typed is lost; the file on disk is untouched until **Save**.
* **Save** writes the file back in place, keeping its permissions.
* UTF-8, UTF-16 and Latin-1 files are all read correctly, and saved back in the encoding — and with the byte-order mark — they came with.
* Files that are not text, or larger than 1 MB, are refused rather than mangled.
* Closing with unsaved changes asks first, on a screen of its own with the answer that keeps your work already selected — **Save and close**, **Discard** or **Keep editing** — rather than in a banner you would have to walk the D-pad back up the whole file to reach. A file changed on disk while you were editing asks the same way, offering **Overwrite** or **Reload**.
* **New file** in the **Y** options menu creates an empty file to start from.

## Recent folders

The last folders you opened are remembered, so getting back to one is a couple of presses rather than a walk down the tree.

* The **Y** options menu has a **Recent Locations** entry, next to the drive shortcuts, listing them most recent first.
* The history is kept by the plugin's own interface, so it does not depend on anything else being in sync.
* The history holds the last 12 folders, survives a plugin reload, and drops folders that no longer exist.
* **Clear history** empties it.

## Steam library shortcut

A game's own context menu — the one the **Options** button opens on a game in the library — gains a **Browse local files** submenu:

* **Installation folder** opens the game's folder under `steamapps/common`, on whichever drive it is installed to. A non-Steam shortcut has no such folder, so its own **Target** is used instead — the entry lands in the folder the shortcut launches from.
* **Compatdata folder** opens its Proton prefix, where saves and configuration for Windows games live. It exists from the first time the game runs through Proton.

Both open the full file manager straight at the folder, so a mod or a config file is a couple of presses from the game itself.

## Drives

Connected drives appear as a row of shortcuts above the file list, each showing its free space, with the drive you are currently browsing highlighted. They are also listed in the **Y** options menu when no file is selected.

Only drives worth navigating to are listed — SD cards, USB storage, external and secondary drives — along with **Home** and the filesystem **root**. System and OS partitions are deliberately filtered out.

## Controls

| Button | Action |
| --- | --- |
| **A** | Open folder, or open a text file in the editor |
| **B** | Tap to go up one directory; **hold** for a moment to leave the plugin from any depth (a progress bar shows the hold) |
| **X** | Toggle split view |
| **Y** | Options menu |
| **L1** / **R1** | Switch to the left / right panel |
| **D-pad** | Navigate, and move between panels |

The **Y** options menu also has an **Exit file manager** entry, if you would rather not hold a button.

## Installation

Download the latest `decky-file-manager.zip` from the [releases](https://github.com/danielcamilo1/Decky-File-Manager/releases) page and install it through Decky Loader's **Install from zip** option, with developer mode enabled.

## Support

This plugin is free and open source, and it will stay that way. If it saved you a trip to Desktop Mode and you feel like saying thanks, you can buy me a coffee — it is genuinely appreciated and it keeps the updates coming ☕

[![Buy me a coffee at ko-fi.com](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/danielcamilo)

Starring the repo, reporting a bug or suggesting a feature helps just as much — and costs nothing.

Decky File Manager was created to fill the gap of native file management in Gaming Mode, bringing the convenience of desktop file managers to a console-like environment without sacrificing usability or immersion.

> **Beta Notice:** Decky File Manager is currently in beta. The plugin is fully functional, but new features, performance improvements, and interface refinements are actively being developed, including:
> * Sudo operations.
>   

## License

See [LICENSE](LICENSE).
