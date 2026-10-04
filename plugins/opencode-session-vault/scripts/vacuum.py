#!/usr/bin/env python3
"""Mantenimiento explícito y fuera de línea. Nunca borra filas de sesiones."""
import argparse
import datetime
import os
import pathlib
import shutil
import sqlite3
import subprocess


def main():
    parser = argparse.ArgumentParser(description="Inspeccionar o compactar OpenCode con copia completa previa.")
    parser.add_argument("database", type=pathlib.Path, help="Ruta explícita a opencode.db")
    parser.add_argument("--vacuum", action="store_true", help="Crear copia completa y compactar, con confirmación")
    args = parser.parse_args()
    db = args.database.expanduser().resolve(strict=True)
    with db.open("rb") as source:
        magic = source.read(16)
    if not db.is_file() or magic != b"SQLite format 3\x00":
        raise RuntimeError("El archivo no es una base SQLite.")
    with sqlite3.connect(db.as_uri() + "?mode=ro", uri=True) as connection:
        if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session'").fetchone():
            raise RuntimeError("No existe la tabla session. No se modificó el archivo.")
        page_size = connection.execute("PRAGMA page_size").fetchone()[0]
        free = connection.execute("PRAGMA freelist_count").fetchone()[0] * page_size
        count = connection.execute("SELECT COUNT(*) FROM session").fetchone()[0]
    print(f"Base: {db}\nSesiones: {count}\nTamaño: {db.stat().st_size / 1024**2:.2f} MiB\nPáginas libres: {free / 1024**2:.2f} MiB")
    if not args.vacuum:
        print("Solo inspección. Añade --vacuum para compactar después de cerrar OpenCode.")
        return
    if os.name == "nt":
        proc = subprocess.run(["tasklist", "/FI", "IMAGENAME eq opencode.exe", "/NH"], capture_output=True, text=True, check=True)
        running = "opencode.exe" in proc.stdout.lower()
    else:
        if not shutil.which("pgrep"):
            raise RuntimeError("No se pudo comprobar si OpenCode está abierto: falta pgrep.")
        proc = subprocess.run(["pgrep", "-x", "opencode"], capture_output=True, text=True)
        if proc.returncode not in (0, 1):
            raise RuntimeError("No se pudo comprobar si OpenCode está abierto.")
        running = proc.returncode == 0
    if running:
        raise RuntimeError("Cierra todas las instancias de OpenCode y vuelve a ejecutar.")
    if input("Confirma que OpenCode está cerrado y seguirá cerrado. Escribe CERRADO: ") != "CERRADO":
        print("Cancelado.")
        return
    needed = db.stat().st_size * 3 + 16 * 1024**2
    if shutil.disk_usage(db.parent).free < needed:
        raise RuntimeError("Espacio insuficiente para copia y compactación (se requieren aproximadamente 3 veces el tamaño de la base).")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = db.with_name(db.name + f".before-vacuum-{stamp}.sqlite")
    before = db.stat().st_size
    with sqlite3.connect(db, timeout=1) as connection:
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise RuntimeError("La integridad no es correcta; no se compactó.")
        with sqlite3.connect(backup) as target:
            connection.backup(target)
            if target.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("No se pudo verificar la copia completa.")
        os.chmod(backup, 0o600)
        connection.execute("VACUUM")
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise RuntimeError(f"Revisa integridad. Copia disponible en: {backup}")
    print(f"Compactado: {before / 1024**2:.2f} → {db.stat().st_size / 1024**2:.2f} MiB\nCopia completa: {backup}")
    print("La copia también ocupa espacio. Muévela a otro disco cuando hayas verificado que OpenCode abre correctamente.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, sqlite3.Error, subprocess.SubprocessError) as error:
        raise SystemExit(f"No se completó el mantenimiento: {error}")
