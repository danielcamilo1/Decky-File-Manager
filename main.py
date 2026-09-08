import os
import threading
import time

import decky
import asyncio

# --------------------------------------------------------------------------
# Privilege handling.
#
# The plugin asks Decky for root (`"flags": ["root"]`) because mounting a
# drive cannot be done without it: udisks2 grants that to an active desktop
# session, which a Gaming Mode plugin is not, and no arrangement of mount
# helpers gets around a polkit refusal.
#
# It then gives root away immediately and permanently, before a single file
# operation can run. A file manager that stayed root would create root-owned
# folders that Steam and games cannot write into, and would let one wrong
# button press take out the OS. What keeps root is a forked child that
# understands two words - install the mount rule, or remove it - and nothing
# else; it takes no arguments, so there is nothing to aim at anything else.
# --------------------------------------------------------------------------

_POLKIT_RULE_PATH = "/etc/polkit-1/rules.d/50-decky-file-manager.rules"


def _polkit_rule_text(user: str) -> str:
    """The one rule this plugin ever installs: `user` may mount volumes."""
    return "\n".join([
        f"// Installed by Decky File Manager for {user}.",
        "// Lets this user mount, unmount and safely remove removable volumes",
        "// through udisks2 without a password prompt - the same permission a",
        "// desktop session already has, extended to Gaming Mode, and to this",
        "// user alone.",
        "polkit.addRule(function (action, subject) {",
        f'    if (subject.user !== "{user}") return polkit.Result.NOT_HANDLED;',
        '    if (action.id.indexOf("org.freedesktop.udisks2.filesystem-mount") === 0 ||',
        '        action.id === "org.freedesktop.udisks2.filesystem-unmount-others" ||',
        '        action.id === "org.freedesktop.udisks2.eject-media" ||',
        '        action.id === "org.freedesktop.udisks2.power-off-drive") {',
        "        return polkit.Result.YES;",
        "    }",
        "    return polkit.Result.NOT_HANDLED;",
        "});",
        "",
    ])


def _decky_user() -> tuple:
    """(name, uid, gid) of the person whose Deck this is.

    USER and HOME describe *this process*, which is root while the flag is
    set; DECKY_USER is the one that keeps naming the real user. Falling back
    to whoever owns the plugin's own directory covers a loader that did not
    set it.
    """
    import pwd

    name = os.environ.get("DECKY_USER") or ""
    if name:
        try:
            entry = pwd.getpwnam(name)
            return (name, entry.pw_uid, entry.pw_gid)
        except KeyError:
            pass
    for probe in (
        os.environ.get("DECKY_PLUGIN_DIR"),
        os.environ.get("DECKY_USER_HOME"),
        os.path.dirname(os.path.abspath(__file__)),
    ):
        if not probe:
            continue
        try:
            info = os.stat(probe)
        except OSError:
            continue
        if info.st_uid:
            try:
                return (pwd.getpwuid(info.st_uid).pw_name, info.st_uid, info.st_gid)
            except KeyError:
                return ("", info.st_uid, info.st_gid)
    return ("", 0, 0)


def _root_helper_main(read_fd: int, write_fd: int, user: str) -> None:
    """The child that keeps root. Two verbs, no arguments, then it is done.

    It reads a word, writes (or deletes) one known file, and answers. An
    empty read means the plugin is gone, and so is this.
    """
    rule = _polkit_rule_text(user)
    while True:
        try:
            data = os.read(read_fd, 64)
        except OSError:
            return
        if not data:
            return
        verb = data.strip()
        try:
            if verb == b"install":
                os.makedirs(os.path.dirname(_POLKIT_RULE_PATH), exist_ok=True)
                with open(_POLKIT_RULE_PATH, "w", encoding="utf-8") as f:
                    f.write(rule)
                os.chmod(_POLKIT_RULE_PATH, 0o644)
                reply = b"ok\n"
            elif verb == b"remove":
                try:
                    os.remove(_POLKIT_RULE_PATH)
                except FileNotFoundError:
                    pass
                reply = b"ok\n"
            else:
                reply = b"error unknown request\n"
        except OSError as e:
            reply = ("error " + str(e).replace("\n", " ") + "\n").encode("utf-8")
        try:
            os.write(write_fd, reply)
        except OSError:
            return


def _spawn_root_helper(user: str) -> tuple | None:
    """Fork the helper while we are still root. Returns (pid, write, read)."""
    try:
        to_child_r, to_child_w = os.pipe()
        to_parent_r, to_parent_w = os.pipe()
    except OSError:
        return None
    try:
        pid = os.fork()
    except OSError:
        for fd in (to_child_r, to_child_w, to_parent_r, to_parent_w):
            try:
                os.close(fd)
            except OSError:
                pass
        return None
    if pid == 0:
        try:
            os.close(to_child_w)
            os.close(to_parent_r)
            _root_helper_main(to_child_r, to_parent_w, user)
        except BaseException:
            pass
        finally:
            os._exit(0)
    os.close(to_child_r)
    os.close(to_parent_w)
    return (pid, to_child_w, to_parent_r)


def _chown_decky_dirs(uid: int, gid: int) -> None:
    """Hand back the directories Decky made for a root plugin.

    They arrive owned by root, and everything this plugin writes to them
    happens after the drop - settings, the clipboard, the log.
    """
    for key in ("DECKY_PLUGIN_SETTINGS_DIR", "DECKY_PLUGIN_RUNTIME_DIR", "DECKY_PLUGIN_LOG_DIR"):
        root_dir = os.environ.get(key)
        if not root_dir or not os.path.isdir(root_dir):
            continue
        for current, dirs, files in os.walk(root_dir):
            for name in [current] + [os.path.join(current, n) for n in dirs + files]:
                try:
                    os.chown(name, uid, gid)
                except OSError:
                    pass


def _prepare_privileges() -> tuple | None:
    """Fork the helper, give root away, and never take it back."""
    if os.geteuid() != 0:
        return None  # Decky started us as the user; nothing to do or undo.
    name, uid, gid = _decky_user()
    if not uid:
        decky.logger.error("Decky File Manager: no unprivileged user to drop to; staying as started")
        return None
    helper = _spawn_root_helper(name or "deck")
    _chown_decky_dirs(uid, gid)
    try:
        if name:
            os.initgroups(name, gid)
        else:
            os.setgroups([gid])
        os.setgid(gid)
        os.setresuid(uid, uid, uid)  # real, effective and saved: no way back
    except OSError as e:
        decky.logger.error(f"Decky File Manager: could not drop privileges ({e}); staying as root")
        return helper
    decky.logger.info(f"Decky File Manager: running as {name or uid}, root kept only by the mount helper")
    return helper


_ROOT_HELPER = _prepare_privileges()


class _CopyCancelled(Exception):
    """Raised inside the copy thread when the user presses Cancel."""


class Plugin:
    def __init__(self):
        self._clipboard_path: str | None = None
        self._clipboard_kind: str | None = None
        self._last_path: str | None = None
        self._recent_paths: list = []
        self._settings: dict = {"default_path": "/home/deck"}
        self._settings_file = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
        self._runtime_file = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "runtime.json")
        self._load_settings()
        self._load_runtime_state()
        # Written by the copy thread, read by the event loop; see the copy
        # progress section below.
        self._progress_lock = threading.Lock()
        self._progress: dict = self._blank_progress()
        self._progress_started = 0.0
        self._cancel = threading.Event()

    def _ensure_runtime_dir(self) -> None:
        os.makedirs(decky.DECKY_PLUGIN_RUNTIME_DIR, exist_ok=True)

    def _ensure_settings_dir(self) -> None:
        os.makedirs(decky.DECKY_PLUGIN_SETTINGS_DIR, exist_ok=True)

    def _load_settings(self) -> None:
        try:
            if os.path.exists(self._settings_file):
                import json

                with open(self._settings_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    default_path = data.get("default_path")
                    if isinstance(default_path, str) and default_path:
                        self._settings["default_path"] = os.path.abspath(default_path)
        except (ValueError, OSError):
            self._settings = {"default_path": "/home/deck"}

    def _save_settings(self) -> None:
        self._ensure_settings_dir()
        import json

        with open(self._settings_file, "w", encoding="utf-8") as f:
            json.dump(self._settings, f, ensure_ascii=False, indent=2)

    def _load_runtime_state(self) -> None:
        try:
            if os.path.exists(self._runtime_file):
                import json

                with open(self._runtime_file, "r", encoding="utf-8") as f:
                    data = json.load(f)

                clipboard = data.get("clipboard", {})
                path = clipboard.get("path")
                kind = clipboard.get("kind")
                if path and kind and os.path.exists(path):
                    self._clipboard_path = os.path.abspath(path)
                    self._clipboard_kind = kind
                else:
                    self._clipboard_path = None
                    self._clipboard_kind = None

                last_path = data.get("last_path")
                if last_path and os.path.isdir(last_path):
                    self._last_path = os.path.abspath(last_path)
                else:
                    self._last_path = None

                recent = data.get("recent_paths") or []
                self._recent_paths = [
                    os.path.abspath(entry) for entry in recent
                    if isinstance(entry, str) and entry
                ][:self._RECENT_LIMIT]
            else:
                self._last_path = None
                self._recent_paths = []
        except (ValueError, OSError):
            self._clipboard_path = None
            self._clipboard_kind = None
            self._last_path = None
            self._recent_paths = []

    def _save_runtime_state(self) -> None:
        self._ensure_runtime_dir()
        import json

        data = {
            "clipboard": {
                "path": self._clipboard_path,
                "kind": self._clipboard_kind,
            },
            "last_path": self._last_path,
            "recent_paths": self._recent_paths,
        }
        with open(self._runtime_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    # How many folders back the history reaches. Long enough to cover a
    # session's worth of jumping around, short enough to stay a menu.
    _RECENT_LIMIT = 12

    def _record_recent(self, path: str) -> None:
        """Most recent first, no duplicates, capped at _RECENT_LIMIT."""
        path = os.path.abspath(path)
        self._recent_paths = [entry for entry in self._recent_paths if entry != path]
        self._recent_paths.insert(0, path)
        del self._recent_paths[self._RECENT_LIMIT:]

    def _normalize_dir(self, path: str) -> str:
        if not path:
            if self._last_path and os.path.isdir(self._last_path):
                return self._last_path
            return self._settings.get("default_path", "/home/deck")
        return os.path.abspath(path)

    def _validate_exists_dir(self, path: str) -> None:
        if not os.path.exists(path):
            raise FileNotFoundError(f"Diretório não encontrado: {path}")
        if not os.path.isdir(path):
            raise NotADirectoryError(f"Não é um diretório: {path}")

    def _unique_target_path(self, target_path: str) -> str:
        """If target_path exists, append (1), (2), ... before extension."""
        if not os.path.exists(target_path):
            return target_path

        base_dir = os.path.dirname(target_path)
        filename = os.path.basename(target_path)
        name, ext = os.path.splitext(filename)

        i = 1
        while True:
            candidate = os.path.join(base_dir, f"{name} ({i}){ext}")
            if not os.path.exists(candidate):
                return candidate
            i += 1

    def _copy_or_cut_prepare(self, src_path: str, kind: str) -> None:
        if not src_path:
            raise ValueError("Caminho inválido")
        src_path = os.path.abspath(src_path)
        if not os.path.exists(src_path):
            raise FileNotFoundError(f"Item não existe: {src_path}")

        self._clipboard_path = src_path
        self._clipboard_kind = kind
        self._save_runtime_state()

    # ------------------------------------------------------------------
    # Copy progress
    #
    # The copy runs in a worker thread (asyncio.to_thread) and writes its
    # counters here while get_transfer_progress reads them from the event
    # loop, so both sides take _progress_lock. Copying goes chunk by chunk
    # instead of through shutil.copytree because a call that only returns
    # once it has finished has nothing to say on the way.
    # ------------------------------------------------------------------

    _COPY_CHUNK = 4 * 1024 * 1024

    @staticmethod
    def _blank_progress() -> dict:
        return {
            "active": False,
            "counting": False,
            "kind": "",
            "name": "",
            "current": "",
            "total_files": 0,
            "copied_files": 0,
            "total_bytes": 0,
            "copied_bytes": 0,
            "elapsed": 0.0,
        }

    def _progress_begin(self, kind: str, name: str, measured: bool) -> None:
        with self._progress_lock:
            self._progress = self._blank_progress()
            self._progress.update({
                "active": True,
                "counting": measured,
                "kind": kind,
                "name": name,
                "current": name,
            })
            self._progress_started = time.monotonic()

    def _progress_totals(self, files: int, size: int) -> None:
        with self._progress_lock:
            self._progress["counting"] = False
            self._progress["total_files"] = files
            self._progress["total_bytes"] = size

    def _progress_current(self, name: str) -> None:
        with self._progress_lock:
            self._progress["current"] = name

    def _progress_bytes(self, amount: int) -> None:
        with self._progress_lock:
            self._progress["copied_bytes"] += amount

    def _progress_file_done(self) -> None:
        with self._progress_lock:
            self._progress["copied_files"] += 1

    def _progress_end(self) -> None:
        with self._progress_lock:
            self._progress["active"] = False
            self._progress["counting"] = False
            self._progress["current"] = ""

    def _measure_source(self, path: str) -> tuple:
        """How many files and bytes the copy is about to move.

        Best effort on purpose: this only feeds the progress bar, so an entry
        that cannot be stat'd counts as nothing rather than failing an
        operation that has not started yet. Directories are visited once by
        real path, which is what stops a symlink loop walking forever.
        """
        files = 0
        size = 0
        seen: set = set()
        stack = [path]
        while stack:
            current = stack.pop()
            try:
                if os.path.isdir(current):
                    real = os.path.realpath(current)
                    if real in seen:
                        continue
                    seen.add(real)
                    with os.scandir(current) as entries:
                        for entry in entries:
                            stack.append(entry.path)
                else:
                    files += 1
                    size += os.path.getsize(current)
            except OSError:
                continue
        return (files, size)

    def _copy_file_tracked(self, src_path: str, dst_path: str) -> None:
        import shutil

        self._progress_current(os.path.basename(src_path))
        try:
            with open(src_path, "rb") as source, open(dst_path, "wb") as target:
                while True:
                    if self._cancel.is_set():
                        raise _CopyCancelled()
                    chunk = source.read(self._COPY_CHUNK)
                    if not chunk:
                        break
                    target.write(chunk)
                    self._progress_bytes(len(chunk))
        except _CopyCancelled:
            # The half-written file is the one thing worth cleaning up: it is
            # not a copy of anything. Whatever finished before it is left
            # alone, which is what a cancelled copy looks like everywhere.
            try:
                os.remove(dst_path)
            except OSError:
                pass
            raise
        shutil.copystat(src_path, dst_path)
        self._progress_file_done()

    def _copy_tree_tracked(self, src_path: str, dst_path: str, dirs_exist_ok: bool = False, seen: set | None = None) -> None:
        import shutil

        seen = set() if seen is None else seen
        real = os.path.realpath(src_path)
        if real in seen:
            return
        seen.add(real)

        os.makedirs(dst_path, exist_ok=dirs_exist_ok)
        with os.scandir(src_path) as entries:
            children = sorted(entries, key=lambda entry: entry.name)
        for entry in children:
            if self._cancel.is_set():
                raise _CopyCancelled()
            # Symlinks are followed, which is what shutil.copytree does by
            # default and therefore what this used to do.
            if entry.is_dir():
                self._copy_tree_tracked(entry.path, os.path.join(dst_path, entry.name), True, seen)
            else:
                self._copy_file_tracked(entry.path, os.path.join(dst_path, entry.name))
        shutil.copystat(src_path, dst_path)

    def _copy_path(self, src_path: str, dst_path: str, dirs_exist_ok: bool = False) -> None:
        if os.path.isdir(src_path):
            self._copy_tree_tracked(src_path, dst_path, dirs_exist_ok)
        else:
            self._copy_file_tracked(src_path, dst_path)

    def _discard_partial(self, path: str) -> None:
        """Throw away a copy that never finished.

        Only ever called on a path this plugin picked for itself, never on
        anything that was already there.
        """
        try:
            self._remove_path(path)
        except OSError:
            pass

    def _same_filesystem(self, src_path: str, dst_path: str) -> bool:
        """Whether a move between these two is a rename rather than a copy."""
        try:
            return os.stat(src_path).st_dev == os.stat(os.path.dirname(dst_path) or "/").st_dev
        except OSError:
            return False

    async def _run_tracked(self, kind: str, source: str, work, measure: bool = True) -> bool:
        """Run a copy in a worker thread with its counters live; True if cancelled.

        The event loop stays free while it runs, which is the entire point:
        get_transfer_progress has to be able to answer mid-copy.
        """
        self._cancel.clear()
        self._progress_begin(kind, os.path.basename(source), measure)

        def job() -> None:
            if measure:
                files, size = self._measure_source(source)
                self._progress_totals(files, size)
            work()

        try:
            await asyncio.to_thread(job)
        except _CopyCancelled:
            return True
        finally:
            self._cancel.clear()
            self._progress_end()
        return False

    async def cancel_transfer(self) -> dict:
        """Stop the running copy at the next chunk."""
        self._cancel.set()
        return {"ok": True}

    async def get_transfer_progress(self) -> dict:
        """Where the running copy has got to; polled by the progress modal."""
        with self._progress_lock:
            snapshot = dict(self._progress)
            started = self._progress_started
        snapshot["elapsed"] = max(0.0, time.monotonic() - started) if started else 0.0
        return snapshot

    def _move_path(self, src_path: str, dst_path: str) -> None:
        try:
            os.rename(src_path, dst_path)
        except OSError as e:
            import errno

            if getattr(e, 'errno', None) == errno.EXDEV:
                # Across filesystems a move is a copy and a delete; going
                # through the tracked copy keeps the progress modal fed.
                self._copy_path(src_path, dst_path)
                self._remove_path(src_path)
            else:
                raise

    def _remove_path(self, path: str) -> None:
        import shutil

        if os.path.isfile(path) or os.path.islink(path):
            os.remove(path)
        elif os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)

    def _is_subpath(self, child_path: str, parent_path: str) -> bool:
        child_real = os.path.realpath(child_path)
        parent_real = os.path.realpath(parent_path)
        try:
            return os.path.commonpath([child_real, parent_real]) == parent_real
        except ValueError:
            return False

    def _is_self_or_subdirectory(self, target_dir: str, src_path: str) -> bool:
        return self._is_subpath(target_dir, src_path)

    def _get_properties(self, target_path: str) -> dict:
        stat = os.stat(target_path, follow_symlinks=False)
        is_dir = os.path.isdir(target_path)

        return {
            "name": os.path.basename(target_path),
            "path": target_path,
            "is_dir": is_dir,
            "size": None if is_dir else stat.st_size,
            "modified": int(stat.st_mtime),
        }

    def _get_directory_size(self, directory: str) -> int:
        """Calculate directory size without following symlinks or failing on restricted entries."""
        total = 0
        pending = [directory]
        while pending:
            current = pending.pop()
            try:
                with os.scandir(current) as entries:
                    for entry in entries:
                        try:
                            if entry.is_symlink():
                                continue
                            if entry.is_dir(follow_symlinks=False):
                                pending.append(entry.path)
                            else:
                                total += entry.stat(follow_symlinks=False).st_size
                        except (PermissionError, FileNotFoundError, OSError):
                            continue
            except (PermissionError, FileNotFoundError, OSError):
                continue
        return total

    def _is_safe_target_for_path(self, target_dir: str, src_path: str) -> bool:
        target_dir = os.path.abspath(target_dir)
        if not target_dir or not os.path.isdir(target_dir):
            return False

        src_real = os.path.realpath(src_path)
        if os.path.isdir(src_real) and self._is_subpath(target_dir, src_real):
            return False

        return True

    def _safe_archive_member_path(self, target_dir: str, member_name: str) -> str:
        """Return a safe extraction path and reject path traversal entries."""
        if not member_name or os.path.isabs(member_name):
            raise ValueError("Arquivo compactado contém um caminho inválido")

        target_dir = os.path.realpath(target_dir)
        destination = os.path.realpath(os.path.join(target_dir, member_name))
        try:
            inside_target = os.path.commonpath([target_dir, destination]) == target_dir
        except ValueError:
            inside_target = False
        if not inside_target:
            raise ValueError("Arquivo compactado contém caminho fora do destino")
        return destination

    def _safe_extract_zip(self, archive_path: str, target_dir: str) -> None:
        import zipfile

        with zipfile.ZipFile(archive_path, "r") as archive:
            for member in archive.infolist():
                destination = self._safe_archive_member_path(target_dir, member.filename)
                if member.is_dir():
                    os.makedirs(destination, exist_ok=True)
                    continue

                os.makedirs(os.path.dirname(destination), exist_ok=True)
                with archive.open(member, "r") as source, open(destination, "wb") as target:
                    import shutil

                    shutil.copyfileobj(source, target)

    def _safe_extract_tar(self, archive_path: str, target_dir: str) -> None:
        import tarfile

        with tarfile.open(archive_path, "r:*") as archive:
            for member in archive.getmembers():
                self._safe_archive_member_path(target_dir, member.name)
                if member.issym() or member.islnk() or not (member.isdir() or member.isfile()):
                    raise ValueError("Arquivo tar contém link ou tipo de arquivo não suportado")

            for member in archive.getmembers():
                destination = self._safe_archive_member_path(target_dir, member.name)
                if member.isdir():
                    os.makedirs(destination, exist_ok=True)
                    continue

                os.makedirs(os.path.dirname(destination), exist_ok=True)
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError("Não foi possível ler um arquivo do tar")
                with source, open(destination, "wb") as target:
                    import shutil

                    shutil.copyfileobj(source, target)

    async def list_dir(self, path: str) -> dict:
        path = self._normalize_dir(path)
        self._validate_exists_dir(path)
        self._last_path = path
        self._record_recent(path)
        self._save_runtime_state()

        entries = []
        try:
            with os.scandir(path) as it:
                for entry in it:
                    try:
                        is_dir = entry.is_dir(follow_symlinks=True)
                    except (PermissionError, FileNotFoundError, OSError):
                        continue

                    try:
                        stat = None if is_dir else entry.stat(follow_symlinks=False)
                    except (PermissionError, FileNotFoundError, OSError):
                        stat = None

                    entries.append({
                        "name": entry.name,
                        "path": entry.path,
                        "is_dir": is_dir,
                        "size": None if is_dir or stat is None else stat.st_size,
                        "modified": 0 if stat is None else int(stat.st_mtime),
                    })
        except PermissionError as e:
            raise PermissionError(f"Sem permissão para acessar: {path}") from e
        except OSError as e:
            raise OSError(f"Não foi possível acessar: {path} ({e.strerror or e})") from e

        entries.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
        return {"path": path, "items": entries}

    async def copy_path(self, path: str) -> dict:
        self._copy_or_cut_prepare(path, "copy")
        return {"ok": True}

    async def cut_path(self, path: str) -> dict:
        self._copy_or_cut_prepare(path, "cut")
        return {"ok": True}

    async def has_clipboard(self) -> dict:
        return {"has": bool(self._clipboard_path)}

    async def get_clipboard_kind(self) -> dict:
        return {"kind": self._clipboard_kind}

    async def copy_or_cut_status(self) -> dict:
        return {
            "has": bool(self._clipboard_path),
            "kind": self._clipboard_kind,
            "path": self._clipboard_path,
        }

    async def get_clipboard_info(self) -> dict:
        return await self.copy_or_cut_status()

    async def check_paste_conflict(self, target_dir: str) -> dict:
        target_dir = self._normalize_dir(target_dir)
        self._validate_exists_dir(target_dir)

        if not self._clipboard_path or not self._clipboard_kind:
            raise ValueError("Área de transferência está vazia")

        src = self._clipboard_path
        kind = self._clipboard_kind
        name = os.path.basename(src)

        if kind == "cut" and self._is_self_or_subdirectory(target_dir, src):
            return {"blocked": True, "reason": "self-directory", "name": name}

        raw_dst = os.path.join(target_dir, name)
        if os.path.exists(raw_dst):
            return {
                "blocked": False,
                "needs_conflict": True,
                "path": raw_dst,
                "name": name,
                "is_dir": os.path.isdir(raw_dst),
            }

        return {"blocked": False, "needs_conflict": False, "path": raw_dst, "name": name}

    async def paste_path(self, target_dir: str) -> dict:
        return await self.paste_path_with_options(target_dir, "keep-both")

    async def paste_path_with_options(self, target_dir: str, conflict_strategy: str = "keep-both", apply_to_all: bool = False) -> dict:
        target_dir = self._normalize_dir(target_dir)
        self._validate_exists_dir(target_dir)

        if not self._clipboard_path or not self._clipboard_kind:
            raise ValueError("Área de transferência está vazia")

        src = self._clipboard_path
        kind = self._clipboard_kind
        name = os.path.basename(src)
        if not self._is_safe_target_for_path(target_dir, src):
            raise ValueError("Destino inválido")

        if kind == "cut" and self._is_self_or_subdirectory(target_dir, src):
            raise ValueError("Não é possível colar dentro do diretório.")

        raw_dst = os.path.join(target_dir, name)
        # Set when the finished copy has to take an existing item's place.
        replacing = ""

        if os.path.exists(raw_dst):
            if conflict_strategy == "ignore":
                return {"ok": True, "skipped": True}
            if conflict_strategy == "cancel":
                return {"ok": True, "cancelled": True}
            if conflict_strategy == "replace" and os.path.realpath(raw_dst) == os.path.realpath(src):
                self._clipboard_path = None
                self._clipboard_kind = None
                self._save_runtime_state()
                return {"ok": True, "conflict_strategy": conflict_strategy}
            if conflict_strategy == "replace":
                # The copy lands beside the old item and takes its place at
                # the end. Deleting first would mean a cancelled or failed
                # copy left the person with neither.
                dst = self._unique_target_path(raw_dst)
                replacing = raw_dst
            elif conflict_strategy == "keep-both":
                dst = self._unique_target_path(raw_dst)
            elif conflict_strategy == "merge":
                dst = raw_dst
            else:
                raise ValueError("Estratégia de conflito inválida")
        else:
            dst = raw_dst

        if kind not in ("copy", "cut"):
            raise ValueError("Clipboard inválida")

        merging = conflict_strategy == "merge" and os.path.isdir(src) and os.path.isdir(dst)

        def work() -> None:
            try:
                if merging:
                    self._copy_path(src, dst, dirs_exist_ok=True)
                    if kind == "cut":
                        self._remove_path(src)
                elif kind == "copy":
                    self._copy_path(src, dst)
                else:
                    self._move_path(src, dst)
            except BaseException:
                if replacing:
                    self._discard_partial(dst)
                raise
            if replacing:
                self._remove_path(replacing)
                os.replace(dst, replacing)

        # A move inside one filesystem is a rename: instant, with nothing to
        # measure and nothing worth watching.
        instant = kind == "cut" and not merging and self._same_filesystem(src, dst)

        try:
            cancelled = await self._run_tracked("copy" if kind == "copy" else "move", src, work, not instant)
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e

        # A cancelled paste has not happened, so the clipboard keeps what it
        # was holding and the person can try again somewhere else.
        if cancelled:
            return {"ok": True, "cancelled": True}

        self._clipboard_path = None
        self._clipboard_kind = None
        self._save_runtime_state()
        return {"ok": True, "conflict_strategy": conflict_strategy}

    async def create_folder(self, parent_dir: str, name: str) -> dict:
        parent_dir = self._normalize_dir(parent_dir)
        self._validate_exists_dir(parent_dir)

        if not name or "/" in name or "\\" in name:
            raise ValueError("Nome inválido")

        new_path = os.path.join(parent_dir, name)
        if os.path.exists(new_path):
            raise FileExistsError(f"Já existe um item com esse nome: {new_path}")

        try:
            os.mkdir(new_path)
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e

        return {"success": True, "path": new_path}

    async def rename_path(self, path: str, new_name: str) -> dict:
        return await self.rename_item(path, new_name)

    async def rename_item(self, old_path: str, new_name: str) -> dict:
        if not old_path:
            raise ValueError("Caminho inválido")
        if not new_name:
            raise ValueError("Novo nome inválido")
        if "/" in new_name or "\\" in new_name:
            raise ValueError("Nome inválido")
        if not os.path.exists(old_path):
            raise FileNotFoundError(f"Item não existe: {old_path}")

        directory = os.path.dirname(old_path)
        new_path = os.path.join(directory, new_name)

        if os.path.exists(new_path):
            raise FileExistsError(f"Já existe um item com esse nome: {new_path}")

        os.rename(old_path, new_path)

        return {"success": True, "new_path": new_path}


    async def delete_path(self, path: str) -> dict:
        return await self.delete_item(path)

    async def delete_item(self, path: str) -> dict:
        if not path:
            raise ValueError("Caminho inválido")
        path = os.path.abspath(path)
        if not os.path.exists(path):
            return {"success": False, "error": "Arquivo ou pasta não encontrado"}

        import shutil

        try:
            if os.path.isfile(path) or os.path.islink(path):
                os.remove(path)
            elif os.path.isdir(path):
                shutil.rmtree(path)
            else:
                os.remove(path)
        except PermissionError as e:
            return {"success": False, "error": f"Sem permissão: {e}"}

        if self._clipboard_path and (self._clipboard_path == path or self._is_subpath(self._clipboard_path, path)):
            self._clipboard_path = None
            self._clipboard_kind = None
            self._save_runtime_state()

        return {"success": True}

    async def extract_archive(self, archive_path: str, target_dir: str) -> dict:
        if not archive_path:
            raise ValueError("Caminho inválido")
        if not target_dir:
            raise ValueError("Destino inválido")

        archive_path = os.path.abspath(archive_path)
        target_dir = self._normalize_dir(target_dir)
        self._validate_exists_dir(target_dir)

        if not os.path.exists(archive_path) or not os.path.isfile(archive_path):
            raise FileNotFoundError(f"Arquivo não encontrado: {archive_path}")

        archive_name = os.path.basename(archive_path)
        target_path = os.path.join(target_dir, os.path.splitext(archive_name)[0])
        if os.path.exists(target_path):
            target_path = self._unique_target_path(target_path)

        try:
            import shutil
            import tarfile

            lower = archive_path.lower()
            if lower.endswith(".zip"):
                self._safe_extract_zip(archive_path, target_path)
            elif lower.endswith(".tar") or lower.endswith(".tar.gz") or lower.endswith(".tgz") or lower.endswith(".tar.bz2") or lower.endswith(".tar.xz") or lower.endswith(".tar.zst"):
                self._safe_extract_tar(archive_path, target_path)
            elif lower.endswith(".gz") and not lower.endswith(".tar.gz") and not lower.endswith(".tgz"):
                self._safe_extract_tar(archive_path, target_path)
            elif lower.endswith(".bz2") and not lower.endswith(".tar.bz2"):
                self._safe_extract_tar(archive_path, target_path)
            elif lower.endswith(".xz") and not lower.endswith(".tar.xz"):
                self._safe_extract_tar(archive_path, target_path)
            elif lower.endswith(".zst") and not lower.endswith(".tar.zst"):
                shutil.unpack_archive(archive_path, target_path)
            else:
                raise ValueError("Formato de arquivo compactado não suportado")
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e
        except (tarfile.TarError, OSError) as e:
            raise ValueError(f"Falha ao extrair o arquivo: {e}") from e

        return {"success": True, "new_path": target_path}

    async def get_properties(self, path: str) -> dict:
        if not path:
            raise ValueError("Caminho inválido")
        path = os.path.abspath(path)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Item não existe: {path}")
        return await self.get_properties_item(path)

    async def get_properties_item(self, path: str) -> dict:
        import datetime

        stat = os.stat(path, follow_symlinks=False)
        is_dir = os.path.isdir(path)


        created = datetime.datetime.fromtimestamp(stat.st_ctime).isoformat()
        modified = datetime.datetime.fromtimestamp(stat.st_mtime).isoformat()

        size = None if is_dir else stat.st_size

        return {
            "name": os.path.basename(path),
            "path": path,
            "size": size,
            "type": "folder" if is_dir else "file",
            "created": created,
            "modified": modified,
            "permissions": oct(stat.st_mode),
        }

    async def get_directory_size(self, path: str) -> dict:
        """Calculate directory size asynchronously and return it."""
        if not path:
            raise ValueError("Caminho inválido")
        path = os.path.abspath(path)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Item não existe: {path}")
        if not os.path.isdir(path):
            return {"size": None, "path": path}

        size = await asyncio.to_thread(self._get_directory_size, path)
        return {"size": size, "path": path}



    # ------------------------------------------------------------------
    # Text editor
    # ------------------------------------------------------------------

    # The whole file crosses the RPC bridge as a single string, and nothing
    # larger than this is worth editing with a gamepad anyway.
    _EDITOR_MAX_BYTES = 1024 * 1024

    # A UTF-16 file is full of NUL bytes, so sniffing raw bytes for NUL would
    # reject perfectly ordinary XML written on Windows. Detect the encoding
    # from the byte-order mark first, and only judge the *decoded* text.
    # UTF-32 BOMs must be tested before UTF-16: b"\xff\xfe\x00\x00" starts
    # with the UTF-16-LE mark.
    _BOM_ENCODINGS = (
        (b"\xff\xfe\x00\x00", "utf-32-le"),
        (b"\x00\x00\xfe\xff", "utf-32-be"),
        (b"\xef\xbb\xbf", "utf-8-bom"),
        (b"\xff\xfe", "utf-16-le"),
        (b"\xfe\xff", "utf-16-be"),
    )

    # Byte-order mark to re-emit, and the codec to use, per stored token.
    _ENCODING_BOMS = {
        "utf-32-le": b"\xff\xfe\x00\x00",
        "utf-32-be": b"\x00\x00\xfe\xff",
        "utf-8-bom": b"\xef\xbb\xbf",
        "utf-16-le": b"\xff\xfe",
        "utf-16-be": b"\xfe\xff",
    }
    _ENCODING_CODECS = {"utf-8-bom": "utf-8"}

    def _decode_text(self, raw: bytes) -> tuple:
        for bom, token in self._BOM_ENCODINGS:
            if raw.startswith(bom):
                try:
                    return raw[len(bom):].decode(self._ENCODING_CODECS.get(token, token)), token
                except UnicodeDecodeError:
                    break

        try:
            return raw.decode("utf-8"), "utf-8"
        except UnicodeDecodeError:
            pass

        if b"\x00" in raw:
            raise ValueError("Arquivo binário não pode ser editado")

        # latin-1 decodes any byte string and re-encodes to exactly the same
        # bytes, so a file we could not read as UTF-8 still round-trips.
        return raw.decode("latin-1"), "latin-1"

    def _encode_text(self, text: str, token: str) -> bytes:
        codec = self._ENCODING_CODECS.get(token, token or "utf-8")
        return self._ENCODING_BOMS.get(token, b"") + text.encode(codec)

    def _read_text(self, path: str) -> tuple:
        with open(path, "rb") as handle:
            raw = handle.read(self._EDITOR_MAX_BYTES + 1)

        if len(raw) > self._EDITOR_MAX_BYTES:
            raise ValueError("Arquivo grande demais para editar")

        text, encoding = self._decode_text(raw)

        # A NUL that survives decoding means this was never text.
        if "\x00" in text:
            raise ValueError("Arquivo binário não pode ser editado")

        return text, encoding

    def _write_text(self, path: str, data: bytes) -> str:
        import tempfile

        directory = os.path.dirname(path) or "/"

        try:
            mode = os.stat(path).st_mode & 0o7777
        except OSError:
            mode = None

        try:
            fd, temp_path = tempfile.mkstemp(dir=directory, prefix=".dfm-edit-", suffix=".tmp")
        except OSError:
            # The directory is not writable, but the file itself may still be;
            # fall back to a plain in-place write rather than failing outright.
            with open(path, "wb") as handle:
                handle.write(data)
            return "direct"

        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            if mode is not None:
                os.chmod(temp_path, mode)
            os.replace(temp_path, path)
        except BaseException:
            try:
                os.remove(temp_path)
            except OSError:
                pass
            raise

        return "atomic"

    async def read_text_file(self, path: str) -> dict:
        if not path:
            raise ValueError("Caminho inválido")
        path = os.path.abspath(path)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Item não existe: {path}")
        if os.path.isdir(path):
            raise IsADirectoryError(f"É uma pasta, não um arquivo: {path}")

        try:
            content, encoding = await asyncio.to_thread(self._read_text, path)
        except PermissionError as e:
            raise PermissionError(f"Sem permissão para ler: {path}") from e

        stat = os.stat(path)

        return {
            "path": path,
            "name": os.path.basename(path),
            "content": content,
            "encoding": encoding,
            "size": stat.st_size,
            "modified": int(stat.st_mtime),
            "read_only": not os.access(path, os.W_OK),
        }

    async def write_text_file(
        self,
        path: str,
        content: str,
        expected_modified: int = 0,
        encoding: str = "utf-8",
        force: bool = False,
    ) -> dict:
        if not path:
            raise ValueError("Caminho inválido")
        # Resolve the link before writing: os.replace on a symlink would swap
        # out the link itself instead of the file it points at.
        path = os.path.realpath(os.path.abspath(path))
        if os.path.isdir(path):
            raise IsADirectoryError(f"É uma pasta, não um arquivo: {path}")

        if os.path.exists(path) and expected_modified and not force:
            current = int(os.stat(path).st_mtime)
            if current != expected_modified:
                return {"success": False, "stale": True, "path": path, "modified": current}

        try:
            data = self._encode_text(content, encoding or "utf-8")
            used_encoding = encoding or "utf-8"
        except (UnicodeEncodeError, LookupError):
            # The file was latin-1 but now holds characters that encoding has
            # no room for; UTF-8 is the only way to keep what was typed.
            data = content.encode("utf-8")
            used_encoding = "utf-8"

        try:
            await asyncio.to_thread(self._write_text, path, data)
        except PermissionError as e:
            raise PermissionError(f"Sem permissão para gravar: {path}") from e
        except OSError as e:
            raise OSError(f"Não foi possível gravar: {path} ({e.strerror or e})") from e

        stat = os.stat(path)

        return {
            "success": True,
            "path": path,
            "size": stat.st_size,
            "modified": int(stat.st_mtime),
            "encoding": used_encoding,
        }

    async def create_file(self, parent_dir: str, name: str) -> dict:
        parent_dir = self._normalize_dir(parent_dir)
        self._validate_exists_dir(parent_dir)

        if not name or "/" in name or "\\" in name or name in (".", ".."):
            raise ValueError("Nome inválido")

        new_path = os.path.join(parent_dir, name)
        if os.path.exists(new_path):
            raise FileExistsError(f"Já existe um item com esse nome: {new_path}")

        try:
            with open(new_path, "x"):
                pass
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e

        return {"success": True, "path": new_path, "new_path": new_path}

    async def get_recent_paths(self) -> dict:
        """Recently visited folders, most recent first, minus any that are gone."""
        existing = [entry for entry in self._recent_paths if os.path.isdir(entry)]

        if existing != self._recent_paths:
            self._recent_paths = existing
            self._save_runtime_state()

        return {"paths": [{"path": entry, "name": os.path.basename(entry) or entry} for entry in existing]}

    async def clear_recent_paths(self) -> dict:
        self._recent_paths = []
        self._save_runtime_state()
        return {"success": True}


    # ------------------------------------------------------------------
    # Drives / mounted volumes
    # ------------------------------------------------------------------

    _PSEUDO_FILESYSTEMS = {
        "autofs", "binfmt_misc", "bpf", "cgroup", "cgroup2", "configfs",
        "debugfs", "devpts", "devtmpfs", "efivarfs", "fuse.gvfsd-fuse",
        "fuse.portal", "fusectl", "hugetlbfs", "mqueue", "nsfs", "overlay",
        "proc", "pstore", "ramfs", "rpc_pipefs", "securityfs", "selinuxfs",
        "squashfs", "sysfs", "tmpfs", "tracefs",
    }

    # Where removable media gets mounted on SteamOS/Bazzite and friends.
    _REMOVABLE_MOUNT_ROOTS = ("/run/media", "/media", "/mnt")

    @staticmethod
    def _unescape_mount_field(field: str) -> str:
        """/proc/mounts octal-escapes space, tab, newline and backslash."""
        out = []
        i = 0
        while i < len(field):
            ch = field[i]
            if ch == "\\" and i + 3 < len(field) and field[i + 1:i + 4].isdigit():
                try:
                    out.append(chr(int(field[i + 1:i + 4], 8)))
                    i += 4
                    continue
                except ValueError:
                    pass
            out.append(ch)
            i += 1
        return "".join(out)

    @staticmethod
    def _device_labels() -> dict:
        """Map realpath(device) -> filesystem label, from /dev/disk/by-label."""
        labels: dict = {}
        by_label = "/dev/disk/by-label"
        try:
            for name in os.listdir(by_label):
                link = os.path.join(by_label, name)
                try:
                    labels[os.path.realpath(link)] = Plugin._unescape_mount_field(name)
                except OSError:
                    continue
        except OSError:
            pass
        return labels

    @staticmethod
    def _is_removable_device(device: str) -> bool | None:
        """True/False from sysfs, or None when the kernel does not say."""
        base = os.path.basename(os.path.realpath(device))
        if not base:
            return None
        # Strip the partition suffix: sda1 -> sda, mmcblk0p1 -> mmcblk0, nvme0n1p2 -> nvme0n1
        import re

        parent = re.sub(r"(p?\d+)$", "", base) if not base.startswith("mmcblk") else re.sub(r"p\d+$", "", base)
        for candidate in (base, parent):
            try:
                with open(f"/sys/class/block/{candidate}/removable", "r", encoding="utf-8") as f:
                    return f.read().strip() == "1"
            except OSError:
                continue
        return None

    @staticmethod
    def _sysfs_bus(device: str) -> str:
        """Which bus a block device hangs off: usb, mmc, nvme, ata or "".

        The kernel's `removable` flag is not the question it looks like: it
        means "removable *media*", so a card reader answers 1 while a USB-C
        SSD or any sizeable USB disk answers 0. Going by that flag alone hides
        exactly the drives people plug in most. The sysfs device path says how
        the thing is actually attached, and reading it needs no privileges.
        """
        real = os.path.realpath(os.path.join("/sys/class/block", os.path.basename(os.path.realpath(device))))
        segments = real.split("/")
        for bus in ("usb", "mmc", "nvme", "ata"):
            if any(segment.startswith(bus) for segment in segments):
                return bus
        return ""

    @staticmethod
    def _parent_disk(device: str) -> str:
        """The whole-disk device a partition belongs to ("sda1" -> "sda")."""
        base = os.path.basename(os.path.realpath(device))
        if not base:
            return ""
        # /sys/class/block/sda1 resolves into .../block/sda/sda1, so the disk
        # is simply the directory above - no name-mangling guesswork, which
        # matters for nvme0n1p3 and mmcblk0p8.
        real = os.path.realpath(os.path.join("/sys/class/block", base))
        if os.path.exists(os.path.join(real, "partition")):
            parent = os.path.basename(os.path.dirname(real))
            if parent:
                return parent
        return base

    # Mount points that only ever belong to the installed system. A disk
    # carrying one of these is the machine's own, and none of its partitions
    # are drives the user plugged in.
    _SYSTEM_MOUNT_ROOTS = (
        "/boot", "/efi", "/esp", "/var", "/usr", "/sysroot", "/home",
        "/etc", "/opt", "/nix", "/ostree", "/srv", "/root",
    )

    # Partition types that hold no browsable user data, by GPT GUID and by
    # the MBR type byte udev reports for a DOS partition table.
    _SYSTEM_PARTITION_TYPES = {
        "c12a7328-f81f-11d2-ba4b-00a0c93ec93b",  # EFI system
        "e3c9e316-0b5c-4db8-817d-f92df00215ae",  # Microsoft reserved
        "de94bba4-06d1-4d40-a16a-bfd50179d6ac",  # Windows recovery
        "0657fd6d-a4ab-43c4-84e5-0933c84b4f4f",  # Linux swap
        "21686148-6449-6e6f-744e-656564454649",  # BIOS boot
        "0xef", "0x82", "0x27",
    }

    def _system_disks(self) -> set:
        """Disks the running system lives on, by whole-disk device name.

        Everything on them - the rootfs slots, /var, /esp, /home - is the
        machine's own storage rather than something the user plugged in, so
        the drives bar hides it unless asked otherwise. Derived from where
        things are mounted rather than from a device whitelist, which is what
        makes it work the same on a 64GB eMMC Deck and an NVMe one.
        """
        disks: set = set()
        try:
            with open("/proc/mounts", "r", encoding="utf-8") as f:
                lines = f.readlines()
        except OSError:
            return disks

        for line in lines:
            parts = line.split()
            if len(parts) < 3:
                continue
            device = self._unescape_mount_field(parts[0])
            point = self._unescape_mount_field(parts[1])
            if not device.startswith("/dev/"):
                continue
            if point != "/" and not point.startswith(self._SYSTEM_MOUNT_ROOTS):
                continue
            disk = self._parent_disk(device)
            if disk:
                disks.add(disk)
        return disks

    @staticmethod
    def _drive_id(props: dict, device: str | None, path: str) -> str:
        """A name for a volume that survives a replug and a remount.

        The filesystem UUID first: a stick keeps it whichever port it lands
        in, and whatever mount point udisks picks this time. The device node
        and the mount point are only fallbacks.
        """
        uuid = props.get("ID_FS_UUID") if props else None
        if uuid:
            return f"uuid:{uuid}"
        if device:
            return f"dev:{os.path.realpath(device)}"
        return f"path:{path}"

    def _disk_usage(self, path: str) -> tuple:
        try:
            stat = os.statvfs(path)
        except OSError:
            return (None, None)
        total = stat.f_blocks * stat.f_frsize
        free = stat.f_bavail * stat.f_frsize
        return (total, free)

    def _make_drive(
        self,
        path: str,
        name: str,
        kind: str,
        device: str | None = None,
        fstype: str | None = None,
        drive_id: str | None = None,
        system: bool = False,
    ) -> dict:
        total, free = self._disk_usage(path)
        return {
            "id": drive_id or f"path:{path}",
            "name": name,
            "path": path,
            "kind": kind,
            "device": device,
            "total": total,
            "free": free,
            "mounted": True,
            "fstype": fstype,
            # A volume belonging to the installed system rather than to the
            # user. Still listed, so it can be turned back on by hand, but
            # the bar leaves it out until then.
            "system": system,
        }

    def _collect_drives(self) -> list:
        drives: list = []
        seen: set = set()
        seen_devices: set = set()

        def add(
            path: str,
            name: str,
            kind: str,
            device: str | None = None,
            fstype: str | None = None,
            drive_id: str | None = None,
            system: bool = False,
        ) -> None:
            if not path or not os.path.isdir(path):
                return
            real = os.path.realpath(path)
            if real in seen:
                return
            seen.add(real)
            drives.append(self._make_drive(path, name, kind, device, fstype, drive_id, system))

        home = os.environ.get("DECKY_USER_HOME") or os.path.expanduser("~")
        if not os.path.isdir(home):
            home = "/home/deck"
        add(home, os.path.basename(home.rstrip("/")) or "home", "home", drive_id="home")

        labels = self._device_labels()
        system_disks = self._system_disks()

        try:
            with open("/proc/mounts", "r", encoding="utf-8") as f:
                mount_lines = f.readlines()
        except OSError:
            mount_lines = []

        for line in mount_lines:
            parts = line.split()
            if len(parts) < 3:
                continue

            device = self._unescape_mount_field(parts[0])
            mount_point = self._unescape_mount_field(parts[1])
            fs_type = parts[2]

            if not device.startswith("/dev/"):
                continue
            if fs_type in self._PSEUDO_FILESYSTEMS:
                continue
            if not os.path.isdir(mount_point):
                continue

            # Whitelist rather than blacklist. A volume is only a "drive" worth
            # offering if the kernel calls it removable, or if it sits where
            # removable media is mounted. Everything else is a system partition
            # (/, /var, /esp, /sysroot, btrfs subvolumes, A/B rootfs slots, ...)
            # which a blacklist can never enumerate reliably across SteamOS,
            # Bazzite and friends.
            in_media_dir = mount_point.startswith(self._REMOVABLE_MOUNT_ROOTS)
            removable = self._is_removable_device(device)
            bus = self._sysfs_bus(device)
            on_system_disk = self._parent_disk(device) in system_disks
            if not (in_media_dir or removable is True or bus == "usb"):
                continue

            real_device = os.path.realpath(device)
            # One entry per physical volume, even when mounted several times.
            if real_device in seen_devices:
                continue
            seen_devices.add(real_device)

            base_device = os.path.basename(real_device)
            props = self._udev_properties(os.path.join("/sys/class/block", base_device))
            if on_system_disk:
                # The machine's own storage, wherever it happens to be
                # mounted - an eMMC Deck calls its internal disk mmcblk0,
                # which would otherwise pass for an SD card.
                kind = "internal"
            elif base_device.startswith("mmcblk") or bus == "mmc":
                kind = "sdcard"
            elif bus == "usb" or removable is True:
                kind = "usb"
            else:
                # Not removable, but mounted as media: a second internal disk.
                kind = "internal"

            name = labels.get(real_device) or os.path.basename(mount_point.rstrip("/")) or base_device
            system = on_system_disk or (props.get("ID_PART_ENTRY_TYPE") or "").lower() in self._SYSTEM_PARTITION_TYPES
            add(mount_point, name, kind, device, fs_type, self._drive_id(props, device, mount_point), system)

        add("/", "/", "root", drive_id="root")

        priority = {"home": 0, "sdcard": 1, "usb": 2, "internal": 3, "root": 4}
        drives.sort(key=lambda d: (priority.get(d["kind"], 5), d["name"].lower()))
        return drives

    # ------------------------------------------------------------------
    # Volumes that are plugged in but not mounted
    # ------------------------------------------------------------------

    # Block devices that are never removable media: loopbacks, RAM disks,
    # device-mapper nodes, software RAID, optical and network block devices.
    _SKIP_BLOCK_PREFIXES = ("loop", "ram", "zram", "dm-", "md", "sr", "fd", "nbd")

    # Signatures that sit on a volume without being a filesystem anyone can
    # browse, so offering to mount them would only ever fail.
    _NON_BROWSABLE_FSTYPES = {
        "swap", "crypto_LUKS", "linux_raid_member", "LVM2_member",
        "zfs_member", "isw_raid_member", "ddf_raid_member",
    }

    _MOUNT_TIMEOUT = 30

    @staticmethod
    def _unescape_udev(value: str) -> str:
        r"""udev writes non-printables in a label as \x20 escapes."""
        out = []
        i = 0
        while i < len(value):
            if value[i] == "\\" and value[i + 1:i + 2] == "x" and len(value) >= i + 4:
                try:
                    out.append(chr(int(value[i + 2:i + 4], 16)))
                    i += 4
                    continue
                except ValueError:
                    pass
            out.append(value[i])
            i += 1
        return "".join(out)

    @staticmethod
    def _udev_properties(sys_path: str) -> dict:
        """What udev recorded about a block device, from its own database.

        The filesystem type and label of an *unmounted* volume are not in
        /proc/mounts and cannot be probed off the raw device without root.
        udev already probed it on plug-in and left the answer in
        /run/udev/data, which is world-readable — cheaper than shelling out
        to lsblk on every poll, and it works unprivileged.
        """
        try:
            with open(os.path.join(sys_path, "dev"), "r", encoding="utf-8") as f:
                devnum = f.read().strip()
        except OSError:
            return {}

        props: dict = {}
        try:
            with open("/run/udev/data/b" + devnum, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    if not line.startswith("E:"):
                        continue
                    key, sep, value = line[2:].strip().partition("=")
                    if sep:
                        props[key] = value
        except OSError:
            return {}
        return props

    def _mount_points(self) -> dict:
        """Map realpath(device) -> where it is mounted right now."""
        points: dict = {}
        try:
            with open("/proc/mounts", "r", encoding="utf-8") as f:
                lines = f.readlines()
        except OSError:
            return points

        for line in lines:
            parts = line.split()
            if len(parts) < 3:
                continue
            device = self._unescape_mount_field(parts[0])
            if not device.startswith("/dev/"):
                continue
            points.setdefault(os.path.realpath(device), self._unescape_mount_field(parts[1]))
        return points

    @staticmethod
    def _device_size(sys_path: str) -> int | None:
        """Size in bytes; sysfs counts in 512-byte sectors whatever the disk."""
        try:
            with open(os.path.join(sys_path, "size"), "r", encoding="utf-8") as f:
                return int(f.read().strip()) * 512
        except (OSError, ValueError):
            return None

    @staticmethod
    def _has_partitions(sys_path: str, name: str) -> bool:
        try:
            entries = os.listdir(sys_path)
        except OSError:
            return False
        return any(
            entry.startswith(name) and os.path.exists(os.path.join(sys_path, entry, "partition"))
            for entry in entries
        )

    def _collect_unmounted_drives(self) -> list:
        """Removable volumes the system has not mounted anywhere.

        Gaming Mode mounts an SD card but nothing auto-mounts a USB stick, so
        without this a drive that is physically plugged in is invisible. The
        whitelist matches the mounted side — removable media only, never an
        idle system partition, which the plugin has no business mounting.
        """
        mounted = self._mount_points()
        labels = self._device_labels()
        system_disks = self._system_disks()
        drives: list = []

        try:
            names = sorted(os.listdir("/sys/class/block"))
        except OSError:
            return drives

        for name in names:
            if name.startswith(self._SKIP_BLOCK_PREFIXES):
                continue

            sys_path = os.path.join("/sys/class/block", name)
            device = os.path.join("/dev", name)
            if not os.path.exists(device):
                continue

            real = os.path.realpath(device)
            if real in mounted:
                continue

            # A disk carved into partitions is not itself mountable; each of
            # its partitions comes round on its own turn.
            if not os.path.exists(os.path.join(sys_path, "partition")) and self._has_partitions(sys_path, name):
                continue

            size = self._device_size(sys_path)
            if not size:
                continue

            base = os.path.basename(real)
            props = self._udev_properties(sys_path)
            id_bus = (props.get("ID_BUS") or "").lower()
            bus = id_bus or self._sysfs_bus(device)
            removable = self._is_removable_device(device)
            on_system_disk = self._parent_disk(device) in system_disks
            is_usb = bus == "usb" and not on_system_disk
            is_card = not on_system_disk and (base.startswith("mmcblk") or bus == "mmc")
            # Everything with a filesystem is listed, the machine's own
            # partitions included — they are marked `system` and the bar hides
            # them by default, but they have to be in the list for the user to
            # be able to turn one back on.
            system = on_system_disk or (props.get("ID_PART_ENTRY_TYPE") or "").lower() in self._SYSTEM_PARTITION_TYPES
            if not (is_usb or is_card or removable is True):
                system = True

            usage = props.get("ID_FS_USAGE")
            fstype = props.get("ID_FS_TYPE") or None
            if usage and usage != "filesystem":
                continue
            if fstype in self._NON_BROWSABLE_FSTYPES:
                continue
            if not fstype and not usage and not props:
                # udev has nothing on file for this device at all. For a USB
                # volume that is worth offering anyway — udisks probes the
                # device itself, and a drive the user can see is better than a
                # silent omission. Anything else is skipped.
                if not is_usb:
                    continue
            elif not fstype and not usage:
                # udev looked and found no filesystem: an unformatted disk, or
                # one it could not identify. Mounting it would only fail.
                continue

            label = self._unescape_udev(props.get("ID_FS_LABEL_ENC") or props.get("ID_FS_LABEL") or "")
            kind = "sdcard" if is_card else ("usb" if is_usb or (removable is True and not on_system_disk) else "internal")

            drives.append({
                "id": self._drive_id(props, device, ""),
                "name": label or labels.get(real) or base,
                "path": "",
                "kind": kind,
                "device": device,
                "total": size,
                "free": None,
                "mounted": False,
                "fstype": fstype,
                "system": system,
            })

        return drives

    # Where a mount helper lives when the plugin's PATH does not mention it.
    _MOUNT_PATH_DIRS = ("/usr/bin", "/bin", "/usr/sbin", "/sbin", "/usr/local/bin")

    @classmethod
    def _resolve_binary(cls, name: str) -> str | None:
        """The absolute path of a mount helper, PATH or no PATH.

        A plugin does not inherit a login shell's environment, so a helper
        that is installed but simply unreachable used to look exactly like
        one that is not installed at all - and both looked like nothing,
        because an attempt that never ran recorded nothing to say for itself.
        """
        import shutil

        if os.path.isabs(name):
            return name if os.access(name, os.X_OK) else None
        found = shutil.which(name)
        if found:
            return found
        for directory in cls._MOUNT_PATH_DIRS:
            candidate = os.path.join(directory, name)
            if os.access(candidate, os.X_OK):
                return candidate
        return None

    @staticmethod
    def _clean_env() -> dict:
        """The environment a system tool should be run in, not ours.

        Decky Loader ships as a PyInstaller binary, so this process runs with
        LD_LIBRARY_PATH pointed at the bundle it unpacked into /tmp. Anything
        spawned from here inherits it and links against Decky's copies of
        libcrypto and friends instead of the system ones, which is how
        systemd-mount came back with "version `OPENSSL_3.4.0' not found"
        rather than an answer about the drive. PyInstaller keeps the real
        values under the _ORIG names for exactly this purpose.
        """
        env = dict(os.environ)
        for name in ("LD_LIBRARY_PATH", "LD_PRELOAD", "PYTHONHOME", "PYTHONPATH"):
            original = env.pop(f"{name}_ORIG", None)
            if original:
                env[name] = original
            else:
                env.pop(name, None)
        return env

    def _run_command(self, command: list) -> tuple:
        """(returncode, stdout, stderr); returncode is None when it never ran."""
        import subprocess

        try:
            proc = subprocess.run(
                command, capture_output=True, text=True, timeout=self._MOUNT_TIMEOUT, env=self._clean_env()
            )
        except FileNotFoundError:
            return (None, "", "")
        except (OSError, subprocess.SubprocessError) as e:
            return (None, "", str(e))
        return (proc.returncode, proc.stdout or "", proc.stderr or "")

    @staticmethod
    def _looks_like_denial(text: str) -> bool:
        lower = text.lower()
        return any(
            needle in lower
            for needle in (
                "not authorized", "não autorizado", "authentication",
                "permission denied", "permissão", "operation not permitted",
                "must be superuser", "only root", "must be root",
            )
        )

    def _mount_target_dir(self, label: str) -> str | None:
        """A directory to mount into when no mount helper picked one for us."""
        user = os.environ.get("DECKY_USER") or os.environ.get("USER") or "deck"
        home = os.environ.get("DECKY_USER_HOME") or os.path.expanduser("~")
        safe = "".join(ch for ch in label if ch.isalnum() or ch in "-_.") or "drive"

        for root in (os.path.join("/run/media", user), os.path.join("/media", user), os.path.join(home, "media")):
            target = os.path.join(root, safe)
            try:
                os.makedirs(target, exist_ok=True)
            except OSError:
                continue
            return target
        return None

    def _ownership_options(self) -> str:
        """uid/gid/umask for the user, so a Windows volume is writable."""
        home = os.environ.get("DECKY_USER_HOME") or os.path.expanduser("~")
        try:
            info = os.stat(home)
        except OSError:
            return ""
        return f"uid={info.st_uid},gid={info.st_gid},umask=022"

    def _mount_options_for(self, fstype: str | None) -> list:
        """Ownership options a Windows-formatted volume needs to be usable.

        Only relevant on the mount(8) fallback — udisks sets these itself —
        and only when that fallback can run at all, which means as root.
        """
        if fstype not in ("vfat", "exfat", "ntfs", "ntfs3", "msdos"):
            return []
        options = self._ownership_options()
        return ["-o", options] if options else []

    @staticmethod
    def _summarize_output(text: str) -> str:
        """One readable line out of a mount helper's complaint."""
        collapsed = " ".join(text.split())
        # udisks wraps everything in a D-Bus error name; the sentence after it
        # is the part a person can act on.
        marker = "GDBus.Error:"
        if marker in collapsed:
            tail = collapsed.split(marker, 1)[1]
            if ": " in tail:
                collapsed = tail.split(": ", 1)[1]
        return collapsed[:240]

    def _mount_device(self, device: str) -> dict:
        """Mount a volume and answer with where it landed.

        Several helpers are tried in turn rather than one. udisks2 is the only
        one with a real chance without root - it is what the desktop uses, and
        it picks both the mount point and the ownership options; ntfs-3g is
        worth a try for a Windows volume because FUSE mounts can be permitted
        for a normal user; systemd-mount and plain mount(8) cover an install
        that does run privileged. Whether any of them worked is read back off
        /proc/mounts rather than parsed out of their output, which differs
        between versions.

        Every attempt is kept, and the answer carries all of them: which tool
        refused and in whose words is the only thing that distinguishes "the
        policy would not let us" from "Windows left this volume dirty", and
        neither is guessable from here. The report travels as the return value
        rather than as an exception message - an exception has to survive the
        RPC bridge, which does not promise to hand the frontend anything more
        than the fact that something went wrong.
        """
        if not device.startswith("/dev/"):
            return self._mount_failure("invalid", device, [])
        if not os.path.exists(device):
            return self._mount_failure("missing", device, [])

        real = os.path.realpath(device)
        existing = self._mount_points().get(real)
        if existing:
            return {"success": True, "path": existing, "reason": "already", "detail": "", "attempts": []}

        props = self._udev_properties(os.path.join("/sys/class/block", os.path.basename(real)))
        fstype = props.get("ID_FS_TYPE") or ""
        label = self._unescape_udev(props.get("ID_FS_LABEL_ENC") or props.get("ID_FS_LABEL") or "")
        attempts: list = []

        def try_command(command: list) -> str | None:
            tool = os.path.basename(command[0])
            binary = self._resolve_binary(command[0])
            if binary is None:
                # Worth saying out loud: a helper being absent is a different
                # problem from a helper refusing, and the two used to be
                # indistinguishable from the outside.
                attempts.append({"tool": tool, "message": "not installed"})
                return None
            code, out, err = self._run_command([binary] + command[1:])
            point = self._mount_points().get(real)
            if point:
                return point
            answer = err or out or (f"exit {code}" if code is not None else "did not run")
            attempts.append({"tool": tool, "message": self._summarize_output(answer)})
            return None

        point = try_command(["udisksctl", "mount", "--no-user-interaction", "-b", device])
        if point:
            return self._mount_success(point, attempts)

        # udisks refuses a volume whose type it could not settle on, which is
        # the usual answer for NTFS on an image that has both the kernel
        # driver and the FUSE one; naming the driver gets past it.
        if fstype in ("ntfs", "ntfs3"):
            for driver in ("ntfs3", "ntfs-3g"):
                point = try_command(
                    ["udisksctl", "mount", "--no-user-interaction", "-b", device, "-t", driver]
                )
                if point:
                    return self._mount_success(point, attempts)

        # A Windows volume that was hibernated or unmounted uncleanly is
        # refused by every driver until someone says otherwise; ntfs-3g is the
        # one that can be told to, and it runs in userspace.
        if fstype in ("ntfs", "ntfs3"):
            target = self._mount_target_dir(label or os.path.basename(real))
            if target:
                info = self._ownership_options()
                point = try_command(
                    ["ntfs-3g", "-o", "remove_hiberfile,recover" + (f",{info}" if info else ""), device, target]
                )
                if point:
                    return self._mount_success(point, attempts)
                self._discard_target_dir(target)

        point = try_command(["systemd-mount", "--no-ask-password", "--collect", device])
        if point:
            return self._mount_success(point, attempts)

        target = self._mount_target_dir(label or os.path.basename(real))
        if target:
            point = try_command(["mount"] + self._mount_options_for(fstype) + [device, target])
            if point:
                return self._mount_success(point, attempts)
            # Nothing was mounted here after all; take the directory back.
            self._discard_target_dir(target)

        if any(self._looks_like_denial(attempt["message"]) for attempt in attempts):
            return self._mount_failure("denied", "", attempts)
        if attempts and all(attempt["message"] == "not installed" for attempt in attempts):
            return self._mount_failure("no_tools", "", attempts)
        return self._mount_failure("failed", "", attempts)

    @staticmethod
    def _mount_success(path: str, attempts: list) -> dict:
        return {"success": True, "path": path, "reason": "ok", "detail": "", "attempts": attempts}

    @staticmethod
    def _attempt_detail(attempts: list) -> str:
        """Every helper's own words, each distinct sentence said once.

        The same helper often refuses the same way several times over (the
        NTFS retries), and three of those is already more than a modal can
        show.
        """
        unique: list = []
        for attempt in attempts:
            entry = f"{attempt['tool']}: {attempt['message']}"
            if attempt["message"] and entry not in unique:
                unique.append(entry)
        return "; ".join(unique[:3])

    @classmethod
    def _mount_failure(cls, reason: str, note: str, attempts: list) -> dict:
        """A failure with every helper's own words attached."""
        return {
            "success": False,
            "path": "",
            "reason": reason,
            "detail": cls._attempt_detail(attempts) or note,
            "attempts": attempts,
        }

    @staticmethod
    def _discard_target_dir(target: str) -> None:
        """Give back a mount directory this plugin created and did not use."""
        for leftover in (target, os.path.dirname(target)):
            try:
                os.rmdir(leftover)
            except OSError:
                break

    def _unmount_target(self, target: str) -> dict:
        """Unmount a device or a mount point, and answer with the freed path.

        Shaped like _mount_device: the result says what happened rather than
        leaving it to an exception message to get across the bridge intact.
        """
        if target.startswith("/dev/"):
            device = target
        else:
            device = ""
            real_target = os.path.realpath(target)
            for candidate, point in self._mount_points().items():
                if os.path.realpath(point) == real_target:
                    device = candidate
                    break
            if not device:
                return self._mount_failure("missing", target, [])

        real = os.path.realpath(device)
        point = self._mount_points().get(real)
        if point is None:
            return {"success": True, "path": "", "reason": "already", "detail": "", "attempts": []}

        attempts: list = []
        for command in (
            ["udisksctl", "unmount", "--no-user-interaction", "-b", device],
            ["umount", device],
        ):
            tool = os.path.basename(command[0])
            binary = self._resolve_binary(command[0])
            if binary is None:
                attempts.append({"tool": tool, "message": "not installed"})
                continue
            code, out, err = self._run_command([binary] + command[1:])
            if real not in self._mount_points():
                # udisks removes the directory it created; one this plugin
                # made itself is left behind, so it goes here.
                try:
                    os.rmdir(point)
                except OSError:
                    pass
                return self._mount_success(point, attempts)
            answer = err or out or (f"exit {code}" if code is not None else "did not run")
            attempts.append({"tool": tool, "message": self._summarize_output(answer)})

        if any(self._looks_like_denial(attempt["message"]) for attempt in attempts):
            return self._mount_failure("denied", "", attempts)
        if attempts and all(attempt["message"] == "not installed" for attempt in attempts):
            return self._mount_failure("no_tools", "", attempts)
        return self._mount_failure("failed", "", attempts)

    def _mounted_partitions(self, disk: str) -> list:
        """Every mounted partition of one physical disk.

        Cutting power to a drive that still has a partition mounted throws
        away whatever the kernel had not written out yet, so a safe eject has
        to let go of all of them, not only the one the user was looking at.
        """
        return [
            device
            for device in self._mount_points()
            if disk and self._parent_disk(device) == disk
        ]

    def _power_off_disk(self, disk: str, attempts: list) -> bool:
        """Ask udisks to cut power to the drive, so it can be pulled out."""
        binary = self._resolve_binary("udisksctl")
        if binary is None:
            attempts.append({"tool": "udisksctl", "message": "not installed"})
            return False
        code, out, err = self._run_command(
            [binary, "power-off", "--no-user-interaction", "-b", f"/dev/{disk}"]
        )
        if code == 0:
            return True
        answer = err or out or (f"exit {code}" if code is not None else "did not run")
        attempts.append({"tool": "power-off", "message": self._summarize_output(answer)})
        return False

    def _eject_target(self, target: str) -> dict:
        """Unmount everything on the drive `target` sits on, then power it off.

        The unmount is what makes the drive safe to unplug; the power-off is
        what makes the system stop listing it, and is deliberately best
        effort - a drive that will not power down has still been flushed and
        unmounted. So `success` follows the unmount, and `powered_off` says
        whether the drive actually went quiet.
        """
        device = target if target.startswith("/dev/") else ""
        if not device:
            real_target = os.path.realpath(target)
            for candidate, point in self._mount_points().items():
                if os.path.realpath(point) == real_target:
                    device = candidate
                    break
        if not device:
            return dict(self._mount_failure("missing", target, []), powered_off=False)

        disk = self._parent_disk(device)
        results = [
            self._unmount_target(partition)
            for partition in (self._mounted_partitions(disk) or [device])
        ]

        for result in results:
            if not result["success"]:
                return dict(result, powered_off=False)

        attempts: list = []
        powered = self._power_off_disk(disk, attempts) if disk else False
        return {
            "success": True,
            "path": next((r["path"] for r in results if r.get("path")), ""),
            "reason": "ok",
            "detail": self._attempt_detail(attempts),
            "attempts": attempts,
            "powered_off": powered,
        }

    _POLKIT_RULE_PATH = _POLKIT_RULE_PATH

    def _mount_permission_script(self) -> str:
        """The same rule as a script, for when the plugin is not running as root.

        udisks2 hands `filesystem-mount` to a user with an *active login
        session*; a Decky plugin runs outside one, so polkit answers "not
        authorized" no matter which helper asks. With Decky's root flag the
        plugin installs the rule itself (`install_mount_permission`); without
        it - an older loader, or a build with the flag taken out - this is the
        fallback, written out for the person to read and run.
        """
        user = self._current_user()
        rule = _polkit_rule_text(user).rstrip("\n")
        return "\n".join([
            "#!/bin/sh",
            "# Decky File Manager - allow mounting drives from Gaming Mode.",
            "# Run it once, as root:  sudo <this file>",
            "# It writes one polkit rule and changes nothing else. Delete the rule",
            f"# to undo it:  sudo rm {self._POLKIT_RULE_PATH}",
            "set -e",
            'if [ "$(id -u)" -ne 0 ]; then',
            '    echo "Run this as root: sudo $0" >&2',
            "    exit 1",
            "fi",
            f'RULE="{self._POLKIT_RULE_PATH}"',
            'if ! mkdir -p "$(dirname "$RULE")" 2>/dev/null || ! touch "$RULE" 2>/dev/null; then',
            '    echo "Cannot write to /etc. On SteamOS run: sudo steamos-readonly disable" >&2',
            "    exit 1",
            "fi",
            "cat > \"$RULE\" <<'DECKY_RULE_EOF'",
            rule,
            "DECKY_RULE_EOF",
            'chmod 644 "$RULE"',
            'echo "Done. Mounting from Gaming Mode should work now."',
            "",
        ])

    @staticmethod
    def _current_user() -> str:
        try:
            import pwd

            return pwd.getpwuid(os.getuid()).pw_name
        except (ImportError, KeyError):
            return os.environ.get("USER") or os.environ.get("DECKY_USER") or "deck"

    async def prepare_mount_permission(self) -> dict:
        """Write the permission script out and say where it went."""
        home = os.environ.get("DECKY_USER_HOME") or os.path.expanduser("~")
        path = os.path.join(home, "decky-file-manager-enable-mounting.sh")
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(self._mount_permission_script())
            os.chmod(path, 0o755)
        except OSError as e:
            return {"success": False, "path": path, "command": "", "detail": str(e),
                    "installed": self._mount_permission_installed()}
        return {
            "success": True,
            "path": path,
            "command": f"sudo {path}",
            "detail": "",
            "installed": self._mount_permission_installed(),
        }

    @classmethod
    def _mount_permission_installed(cls) -> bool:
        return os.path.exists(cls._POLKIT_RULE_PATH)

    @staticmethod
    def _ask_root_helper(verb: str) -> tuple:
        """Say one of the two words to the child that kept root."""
        import select

        if _ROOT_HELPER is None:
            return (False, "no root helper")
        _pid, write_fd, read_fd = _ROOT_HELPER
        try:
            os.write(write_fd, f"{verb}\n".encode("utf-8"))
            ready, _writable, _bad = select.select([read_fd], [], [], 20)
            if not ready:
                return (False, "timed out")
            answer = os.read(read_fd, 256).decode("utf-8", errors="replace").strip()
        except OSError as e:
            return (False, str(e))
        if answer == "ok":
            return (True, "")
        return (False, answer[6:] if answer.startswith("error ") else answer or "no answer")

    async def get_mount_permission(self) -> dict:
        """Whether mounting is allowed, and whether this build can allow it."""
        return {
            "installed": self._mount_permission_installed(),
            "can_install": _ROOT_HELPER is not None,
            "user": self._current_user(),
        }

    async def install_mount_permission(self) -> dict:
        """Grant this user the right to mount removable volumes."""
        ok, error = await asyncio.to_thread(self._ask_root_helper, "install")
        return {"success": ok, "detail": error, "installed": self._mount_permission_installed()}

    async def remove_mount_permission(self) -> dict:
        """Take that right away again."""
        ok, error = await asyncio.to_thread(self._ask_root_helper, "remove")
        return {"success": ok, "detail": error, "installed": self._mount_permission_installed()}

    async def mount_drive(self, device: str) -> dict:
        return await asyncio.to_thread(self._mount_device, device)

    async def unmount_drive(self, target: str) -> dict:
        return await asyncio.to_thread(self._unmount_target, target)

    async def eject_drive(self, target: str) -> dict:
        """Unmount and power down a drive so it can be pulled out safely."""
        return await asyncio.to_thread(self._eject_target, target)

    async def _refresh_mount_permission(self) -> None:
        """Keep a rule the user already allowed up to date.

        The rule gained the power-off action when safe eject arrived, and
        someone who pressed Allow mounting before that would otherwise be
        left with one that no longer covers what the button does. Only a rule
        that is already installed is rewritten - nothing is ever installed on
        the user's behalf.
        """
        if _ROOT_HELPER is None or not self._mount_permission_installed():
            return
        try:
            with open(self._POLKIT_RULE_PATH, "r", encoding="utf-8") as f:
                installed = f.read()
        except OSError:
            return
        if installed == _polkit_rule_text(self._current_user()):
            return
        ok, error = await asyncio.to_thread(self._ask_root_helper, "install")
        decky.logger.info(
            "Decky File Manager: mount rule refreshed" if ok
            else f"Decky File Manager: could not refresh the mount rule ({error})"
        )

    async def list_drives(self) -> dict:
        """Every volume worth offering, mounted or merely plugged in.

        The two halves are gathered separately — /proc/mounts on one side,
        sysfs on the other — and merged here so the frontend has a single
        list to draw, with the unmounted entries of a kind sitting right
        after the mounted ones.
        """
        drives = await asyncio.to_thread(self._collect_drives)
        unmounted = await asyncio.to_thread(self._collect_unmounted_drives)
        entries = drives + unmounted
        priority = {"home": 0, "sdcard": 1, "usb": 2, "internal": 3, "root": 4}
        entries.sort(key=lambda d: (
            1 if d.get("system") else 0,
            priority.get(d["kind"], 5),
            0 if d.get("mounted", True) else 1,
            d["name"].lower(),
        ))
        return {"drives": entries}

    # ------------------------------------------------------------------
    # Steam game folders (for the library context menu)
    # ------------------------------------------------------------------

    _STEAM_ROOT_CANDIDATES = (
        "~/.local/share/Steam",
        "~/.steam/steam",
        "~/.steam/root",
        "~/.var/app/com.valvesoftware.Steam/.local/share/Steam",
    )

    def _steam_roots(self) -> list:
        home = os.environ.get("DECKY_USER_HOME") or os.path.expanduser("~")
        roots: list = []
        seen: set = set()

        for candidate in self._STEAM_ROOT_CANDIDATES:
            path = os.path.join(home, candidate[2:]) if candidate.startswith("~/") else candidate
            if not os.path.isdir(path):
                continue
            real = os.path.realpath(path)
            if real in seen:
                continue
            seen.add(real)
            roots.append(real)

        return roots

    def _steam_libraries(self) -> list:
        """Every steamapps directory Steam knows about, the install roots included.

        libraryfolders.vdf has had two shapes: `"1" "/path"` in the old one and
        a nested block with a `"path"` key in the current one. Both are read by
        the same scan, rather than by a VDF parser the plugin does not ship.
        Entries that are not library folders — the numeric keys inside an
        "apps" block match the same pattern — fall out on the isdir check.
        """
        import re

        libraries: list = []
        seen: set = set()

        def add(folder: str) -> None:
            if not folder:
                return
            for name in ("steamapps", "SteamApps"):
                steamapps = os.path.join(folder, name)
                if not os.path.isdir(steamapps):
                    continue
                real = os.path.realpath(steamapps)
                if real in seen:
                    return
                seen.add(real)
                libraries.append(real)
                return

        for root in self._steam_roots():
            add(root)
            for name in ("steamapps", "SteamApps"):
                vdf = os.path.join(root, name, "libraryfolders.vdf")
                if not os.path.isfile(vdf):
                    continue
                try:
                    with open(vdf, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()
                except OSError:
                    continue
                for match in re.finditer(r'"(?:path|\d+)"\s+"([^"]+)"', content):
                    add(match.group(1))

        return libraries

    def _game_folders(self, appid: str) -> dict:
        import re

        install = None
        compat = None
        name = None

        for steamapps in self._steam_libraries():
            if install is None:
                manifest = os.path.join(steamapps, "appmanifest_" + appid + ".acf")
                if os.path.isfile(manifest):
                    try:
                        with open(manifest, "r", encoding="utf-8", errors="replace") as f:
                            content = f.read()
                    except OSError:
                        content = ""
                    title = re.search(r'"name"\s+"([^"]*)"', content)
                    if title and name is None:
                        name = title.group(1)
                    installdir = re.search(r'"installdir"\s+"([^"]+)"', content)
                    if installdir:
                        candidate = os.path.join(steamapps, "common", installdir.group(1))
                        if os.path.isdir(candidate):
                            install = candidate

            if compat is None:
                # Non-Steam shortcuts have no manifest but do get a prefix, so
                # this is looked up on its own rather than off the install dir.
                candidate = os.path.join(steamapps, "compatdata", appid)
                if os.path.isdir(candidate):
                    compat = candidate

            if install and compat:
                break

        if install is None:
            # No manifest means it is not a Steam game. A non-Steam shortcut
            # still knows where it points, so the folder comes from the
            # shortcut's own Target field instead.
            shortcut = self._shortcut_folder(appid)
            install = shortcut.get("install")
            if name is None:
                name = shortcut.get("name")

        return {"install": install, "compat": compat, "name": name}

    def _parse_binary_vdf(self, data: bytes, pos: int = 0) -> tuple:
        """One map out of a binary VDF, and where it ended.

        shortcuts.vdf is Steam's binary format, not the text one: a map is a
        run of typed entries — 0x00 nested map, 0x01 string, 0x02 int32,
        0x07 uint64 — each a NUL-terminated key followed by its value, closed
        by 0x08. Keys are lowercased because Steam's own casing has changed
        between clients ("AppName" and "appname" both appear in the wild).
        """
        result: dict = {}
        size = len(data)

        while pos < size:
            marker = data[pos]
            pos += 1
            if marker == 0x08:
                return result, pos

            end = data.find(b"\x00", pos)
            if end == -1:
                break
            key = data[pos:end].decode("utf-8", "replace").lower()
            pos = end + 1

            if marker == 0x00:
                value, pos = self._parse_binary_vdf(data, pos)
            elif marker == 0x01:
                end = data.find(b"\x00", pos)
                if end == -1:
                    break
                value = data[pos:end].decode("utf-8", "replace")
                pos = end + 1
            elif marker == 0x02:
                value = int.from_bytes(data[pos:pos + 4], "little", signed=False)
                pos += 4
            elif marker == 0x07:
                value = int.from_bytes(data[pos:pos + 8], "little", signed=False)
                pos += 8
            else:
                # An entry type this reader does not know: the rest of the
                # file can no longer be located, so stop with what was read.
                break

            result[key] = value

        return result, pos

    def _shortcut_entries(self) -> list:
        """Every non-Steam shortcut, from every account on this machine."""
        entries: list = []

        for root in self._steam_roots():
            userdata = os.path.join(root, "userdata")
            if not os.path.isdir(userdata):
                continue
            try:
                users = os.listdir(userdata)
            except OSError:
                continue

            for user in users:
                path = os.path.join(userdata, user, "config", "shortcuts.vdf")
                if not os.path.isfile(path):
                    continue
                try:
                    with open(path, "rb") as f:
                        data = f.read()
                except OSError:
                    continue
                try:
                    parsed, _ = self._parse_binary_vdf(data)
                except (ValueError, IndexError):
                    continue

                shortcuts = parsed.get("shortcuts")
                if not isinstance(shortcuts, dict):
                    continue
                for entry in shortcuts.values():
                    if isinstance(entry, dict):
                        entries.append(entry)

        return entries

    def _shortcut_ids(self, entry: dict) -> set:
        """The ids a shortcut can be known by in the library.

        The stored appid is a 32-bit value that some clients wrote signed, and
        older shortcuts have none at all — theirs is derived from the target
        and the name, the way Steam derives it.
        """
        import zlib

        ids: set = set()

        raw = entry.get("appid")
        if isinstance(raw, int):
            ids.add(raw & 0xFFFFFFFF)

        # Steam derives the legacy id from the target exactly as stored,
        # quotes included; the unquoted form is added too, since it is what
        # some clients wrote.
        raw_exe = str(entry.get("exe") or "")
        appname = str(entry.get("appname") or "")
        for variant in (raw_exe, raw_exe.strip().strip('"')):
            if not variant:
                continue
            legacy = zlib.crc32((variant + appname).encode("utf-8")) | 0x80000000
            ids.add(legacy & 0xFFFFFFFF)

        return ids

    def _shortcut_folder(self, appid: str) -> dict:
        """Where a non-Steam shortcut lives, taken from its Target field.

        Target is the executable the shortcut launches, so its directory is
        what the game's folder means for a non-Steam game. "Start In" is the
        fallback: it is normally the same folder, and it is what remains when
        the target itself has gone missing.
        """
        try:
            wanted = int(appid) & 0xFFFFFFFF
        except ValueError:
            return {"install": None, "name": None}

        for entry in self._shortcut_entries():
            if wanted not in self._shortcut_ids(entry):
                continue

            name = str(entry.get("appname") or "").strip() or None
            exe = str(entry.get("exe") or "").strip().strip('"')
            start_dir = str(entry.get("startdir") or "").strip().strip('"')

            for candidate in (os.path.dirname(exe) if exe else "", start_dir):
                if candidate and os.path.isdir(candidate):
                    return {"install": os.path.realpath(candidate), "name": name}

            return {"install": None, "name": name}

        return {"install": None, "name": None}

    async def get_game_folders(self, appid: str) -> dict:
        appid = str(appid or "").strip()
        if not appid.isdigit():
            raise ValueError("AppID inválido")
        return await asyncio.to_thread(self._game_folders, appid)

    # ------------------------------------------------------------------
    # Direct transfers between panels (do not touch the clipboard)
    # ------------------------------------------------------------------

    def _validate_transfer(self, src_path: str, target_dir: str) -> tuple:
        if not src_path:
            raise ValueError("Caminho inválido")
        if not target_dir:
            raise ValueError("Destino inválido")

        src_path = os.path.abspath(src_path)
        target_dir = self._normalize_dir(target_dir)
        self._validate_exists_dir(target_dir)

        if not os.path.exists(src_path):
            raise FileNotFoundError(f"Item não existe: {src_path}")
        if not self._is_safe_target_for_path(target_dir, src_path):
            raise ValueError("Destino inválido")
        if os.path.realpath(os.path.dirname(src_path)) == os.path.realpath(target_dir):
            raise ValueError("Origem e destino são a mesma pasta")

        return (src_path, target_dir)

    async def check_transfer_conflict(self, src_path: str, target_dir: str) -> dict:
        src_path, target_dir = self._validate_transfer(src_path, target_dir)
        name = os.path.basename(src_path)
        raw_dst = os.path.join(target_dir, name)

        if os.path.exists(raw_dst):
            return {
                "needs_conflict": True,
                "path": raw_dst,
                "name": name,
                "is_dir": os.path.isdir(raw_dst),
            }

        return {"needs_conflict": False, "path": raw_dst, "name": name}

    async def transfer_path(self, src_path: str, target_dir: str, mode: str = "copy", conflict_strategy: str = "keep-both") -> dict:
        if mode not in ("copy", "cut"):
            raise ValueError("Modo de transferência inválido")

        src_path, target_dir = self._validate_transfer(src_path, target_dir)

        if mode == "cut" and self._is_self_or_subdirectory(target_dir, src_path):
            raise ValueError("Não é possível colar dentro do diretório.")

        name = os.path.basename(src_path)
        raw_dst = os.path.join(target_dir, name)
        replacing = ""

        if os.path.exists(raw_dst):
            if conflict_strategy == "ignore":
                return {"ok": True, "skipped": True}
            if conflict_strategy == "cancel":
                return {"ok": True, "cancelled": True}
            if conflict_strategy == "replace":
                # Beside the old item first, in its place at the end.
                dst = self._unique_target_path(raw_dst)
                replacing = raw_dst
            elif conflict_strategy == "keep-both":
                dst = self._unique_target_path(raw_dst)
            elif conflict_strategy == "merge":
                dst = raw_dst
            else:
                raise ValueError("Estratégia de conflito inválida")
        else:
            dst = raw_dst

        merging = conflict_strategy == "merge" and os.path.isdir(src_path) and os.path.isdir(dst)

        def work() -> None:
            try:
                if merging:
                    self._copy_path(src_path, dst, dirs_exist_ok=True)
                    if mode == "cut":
                        self._remove_path(src_path)
                elif mode == "copy":
                    self._copy_path(src_path, dst)
                else:
                    self._move_path(src_path, dst)
            except BaseException:
                if replacing:
                    self._discard_partial(dst)
                raise
            if replacing:
                self._remove_path(replacing)
                os.replace(dst, replacing)

        instant = mode == "cut" and not merging and self._same_filesystem(src_path, dst)

        try:
            cancelled = await self._run_tracked("copy" if mode == "copy" else "move", src_path, work, not instant)
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e

        if cancelled:
            return {"ok": True, "cancelled": True}

        if mode == "cut" and self._clipboard_path and (
            self._clipboard_path == src_path or self._is_subpath(self._clipboard_path, src_path)
        ):
            self._clipboard_path = None
            self._clipboard_kind = None
            self._save_runtime_state()

        return {"ok": True, "success": True, "new_path": replacing or dst, "conflict_strategy": conflict_strategy}

    async def long_running(self):
        await asyncio.sleep(15)
        pass

    async def _main(self):
        self.loop = asyncio.get_event_loop()
        await self._refresh_mount_permission()

    async def _unload(self):
        pass

    async def _uninstall(self):
        pass

    async def start_timer(self):
        self.loop.create_task(self.long_running())

    async def _migration(self):
        decky.logger.info("Migrating")
        decky.migrate_logs(os.path.join(decky.DECKY_USER_HOME,
                               ".config", "decky-file-manager", "plugin.log"))
        decky.migrate_settings(
            os.path.join(decky.DECKY_HOME, "settings", "decky-file-manager.json"),
            os.path.join(decky.DECKY_USER_HOME, ".config", "decky-file-manager"))
        decky.migrate_runtime(
            os.path.join(decky.DECKY_HOME, "decky-file-manager"),
            os.path.join(decky.DECKY_USER_HOME, ".local", "share", "decky-file-manager"))
