# Decky File Manager

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/danielcamilo)

> This is a fork of [Ciphay/Decky-File-Manager](https://github.com/Ciphay/Decky-File-Manager), continuing the original plugin with additional features. All credit for the original work goes to [Ciphay](https://github.com/Ciphay).

A native, controller-friendly file manager for SteamOS Gaming Mode. Browse, copy, move, rename, delete and extract files without leaving the Steam interface.

### Interface

<img width="800" height="450" alt="Interface" src="https://github.com/user-attachments/assets/291c02ae-88ca-4778-b554-280446d8e862" />


### Context Menu

<img width="800" height="450" alt="Context Menu" src="https://github.com/user-attachments/assets/e456b581-5d85-4a98-95f9-4cddf0a2d3de" />


### Navigation

<img width="800" height="450" alt="Navigation" src="https://github.com/user-attachments/assets/5280ba95-df8e-419f-b7ca-74c60973c41e" />


## Features

* **Split view** — two folders side by side, with **Copy / Move to other panel** in the **Y** menu.
* **List and grid views** — grid fits more per screen; the tile under the cursor is filled and shows its full name.
* **Toolbar** — Hidden, Split, Order, Type and View, all equally sized with the current value on show. **A** steps to the next value in place, no menus over the file list. Every choice is remembered between sessions.
* **Built-in text editor** — the whole file on screen as numbered lines; **A** edits a line with the SteamOS keyboard, **▲/▼** move the field between lines, **Split here / Insert / Delete / Clear**, and **Save** writes back in place. UTF-8, UTF-16 and Latin-1 are read and saved in their own encoding. Unsaved work is always asked about before closing.
* **Recent folders** — the last 12 folders under **Recent Locations** in the **Y** menu.
* **Browse a game's files from its Steam menu** — **Browse local files** on any game opens its installation folder or Proton compatdata. Non-Steam shortcuts included.
* **Drive shortcuts** — SD card, USB and external drives with free space, above the list; system partitions filtered out.
* File and folder management, archive extraction (zip, tar and variants), multi-language support.
* Designed for SteamOS and Bazzite. Lightweight, and SteamOS-inspired throughout.

## Controls

| Button | Action |
| --- | --- |
| **A** | Open folder, or open a text file in the editor |
| **B** | Tap to go up one directory; **hold** to leave the plugin from any depth |
| **X** | Toggle split view |
| **Y** | Options menu |
| **L1** / **R1** | Switch to the left / right panel |
| **D-pad** | Navigate, and move between panels |

The **Y** menu also has an **Exit file manager** entry, if you would rather not hold a button.

## Installation

Download the latest `decky-file-manager.zip` from the [releases](https://github.com/danielcamilo1/Decky-File-Manager/releases) page and install it through Decky Loader's **Install from zip** option, with developer mode enabled.

## Support

This plugin is free and open source, and it will stay that way. If it saved you a trip to Desktop Mode, you can buy me a coffee ☕ — starring the repo, reporting a bug or suggesting a feature helps just as much, and costs nothing.

[![Buy me a coffee at ko-fi.com](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/danielcamilo)

Still on the list: sudo operations.

## License

See [LICENSE](LICENSE).
