import os

import decky
import asyncio

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

    def _copy_path(self, src_path: str, dst_path: str) -> None:
        if os.path.isdir(src_path):
            import shutil

            shutil.copytree(src_path, dst_path, dirs_exist_ok=False)
        else:
            import shutil

            shutil.copy2(src_path, dst_path)

    def _move_path(self, src_path: str, dst_path: str) -> None:
        try:
            os.rename(src_path, dst_path)
        except OSError as e:
            import errno
            import shutil

            if getattr(e, 'errno', None) == errno.EXDEV:
                shutil.move(src_path, dst_path)
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
                self._remove_path(raw_dst)
                dst = raw_dst
            elif conflict_strategy == "keep-both":
                dst = self._unique_target_path(raw_dst)
            elif conflict_strategy == "merge":
                dst = raw_dst
            else:
                raise ValueError("Estratégia de conflito inválida")
        else:
            dst = raw_dst

        try:
            if conflict_strategy == "merge" and os.path.isdir(src) and os.path.isdir(dst):
                import shutil

                if kind == "copy":
                    shutil.copytree(src, dst, dirs_exist_ok=True)
                elif kind == "cut":
                    shutil.copytree(src, dst, dirs_exist_ok=True)
                    shutil.rmtree(src)
                else:
                    raise ValueError("Clipboard inválida")
            elif kind == "copy":
                self._copy_path(src, dst)
            elif kind == "cut":
                self._move_path(src, dst)
            else:
                raise ValueError("Clipboard inválida")
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e

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

    def _disk_usage(self, path: str) -> tuple:
        try:
            stat = os.statvfs(path)
        except OSError:
            return (None, None)
        total = stat.f_blocks * stat.f_frsize
        free = stat.f_bavail * stat.f_frsize
        return (total, free)

    def _make_drive(self, path: str, name: str, kind: str, device: str | None = None) -> dict:
        total, free = self._disk_usage(path)
        return {
            "name": name,
            "path": path,
            "kind": kind,
            "device": device,
            "total": total,
            "free": free,
        }

    def _collect_drives(self) -> list:
        drives: list = []
        seen: set = set()
        seen_devices: set = set()

        def add(path: str, name: str, kind: str, device: str | None = None) -> None:
            if not path or not os.path.isdir(path):
                return
            real = os.path.realpath(path)
            if real in seen:
                return
            seen.add(real)
            drives.append(self._make_drive(path, name, kind, device))

        home = os.environ.get("DECKY_USER_HOME") or os.path.expanduser("~")
        if not os.path.isdir(home):
            home = "/home/deck"
        add(home, os.path.basename(home.rstrip("/")) or "home", "home")

        labels = self._device_labels()

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
            if not (in_media_dir or removable is True):
                continue

            real_device = os.path.realpath(device)
            # One entry per physical volume, even when mounted several times.
            if real_device in seen_devices:
                continue
            seen_devices.add(real_device)

            base_device = os.path.basename(real_device)
            if base_device.startswith("mmcblk"):
                kind = "sdcard"
            elif removable is True:
                kind = "usb"
            else:
                # Not removable, but mounted as media: a second internal disk.
                kind = "internal"

            name = labels.get(real_device) or os.path.basename(mount_point.rstrip("/")) or base_device
            add(mount_point, name, kind, device)

        add("/", "/", "root")

        priority = {"home": 0, "sdcard": 1, "usb": 2, "internal": 3, "root": 4}
        drives.sort(key=lambda d: (priority.get(d["kind"], 5), d["name"].lower()))
        return drives

    async def list_drives(self) -> dict:
        drives = await asyncio.to_thread(self._collect_drives)
        return {"drives": drives}

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

        return {"install": install, "compat": compat, "name": name}

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

        if os.path.exists(raw_dst):
            if conflict_strategy == "ignore":
                return {"ok": True, "skipped": True}
            if conflict_strategy == "cancel":
                return {"ok": True, "cancelled": True}
            if conflict_strategy == "replace":
                self._remove_path(raw_dst)
                dst = raw_dst
            elif conflict_strategy == "keep-both":
                dst = self._unique_target_path(raw_dst)
            elif conflict_strategy == "merge":
                dst = raw_dst
            else:
                raise ValueError("Estratégia de conflito inválida")
        else:
            dst = raw_dst

        try:
            if conflict_strategy == "merge" and os.path.isdir(src_path) and os.path.isdir(dst):
                import shutil

                shutil.copytree(src_path, dst, dirs_exist_ok=True)
                if mode == "cut":
                    shutil.rmtree(src_path)
            elif mode == "copy":
                self._copy_path(src_path, dst)
            else:
                self._move_path(src_path, dst)
        except PermissionError as e:
            raise PermissionError(f"Sem permissão: {e}") from e

        if mode == "cut" and self._clipboard_path and (
            self._clipboard_path == src_path or self._is_subpath(self._clipboard_path, src_path)
        ):
            self._clipboard_path = None
            self._clipboard_kind = None
            self._save_runtime_state()

        return {"ok": True, "success": True, "new_path": dst, "conflict_strategy": conflict_strategy}

    async def long_running(self):
        await asyncio.sleep(15)
        pass

    async def _main(self):
        self.loop = asyncio.get_event_loop()

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
