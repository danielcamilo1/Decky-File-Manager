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
* **Copy and move directly between panels**, the way desktop file managers work.
* **Quick access to connected drives** — SD card, USB sticks and external drives.
* **Built-in text editor** — open, edit and save text files without leaving Gaming Mode.
* **Recent folders** — jump straight back to the last folders you visited.
* File and folder management.
* Copy, move, rename, and delete operations.
* Archive extraction (zip, tar and variants).
* Multi-language support.
* Designed for SteamOS and Bazzite.
* Lightweight and easy to use.
* SteamOS-inspired user interface.

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
* The file is shown as a list of numbered lines. Press **A** on a line to edit it — the Steam on-screen keyboard opens on the text field — then **Apply**. The same panel can **insert a line below** or **delete** the line.
* Everything is reachable with the D-pad; **B** backs out of the line you are typing before it backs out of the file.
* **Save** writes the file back in place, keeping its permissions.
* UTF-8, UTF-16 and Latin-1 files are all read correctly, and saved back in the encoding — and with the byte-order mark — they came with.
* Files that are not text, or larger than 1 MB, are refused rather than mangled.
* Closing with unsaved changes asks before discarding them, and a file changed on disk while you were editing offers **Overwrite** or **Reload**.
* **New file** in the **Y** options menu creates an empty file to start from.

## Recent folders

The last folders you opened are remembered, so getting back to one is a couple of presses rather than a walk down the tree.

* **Recent folders** in the **Y** options menu lists them, most recent first.
* The history holds the last 12 folders, survives a plugin reload, and drops folders that no longer exist.
* **Clear history** empties it.

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
> * Integration with "browse" button on game properties.
> * Sudo operations.
>   

## License

See [LICENSE](LICENSE).
