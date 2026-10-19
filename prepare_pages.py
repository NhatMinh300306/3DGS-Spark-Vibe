#!/usr/bin/env python3
"""Copy this viewer and the existing Redandblack PLY dataset from dist to docs.

Run from CMD: py prepare_pages.py
Use --frontend-only to keep an already-hosted dataset untouched.
No existing destination files are deleted and no Git commands run automatically.
"""
import argparse
import shutil
from pathlib import Path

from tools.package_source import package_source


REQUIRED_FRONTEND = ("index.html", "app.js", "sequence.js", "scenes.js", "style.css")


def missing_dataset_files(source):
    dataset = source / "data" / "redandblack-pages"
    return [dataset / resolution / f"{frame:06d}.ply"
            for resolution in ("res1", "res2", "res4", "res8")
            for frame in range(1450, 1480)
            if not (dataset / resolution / f"{frame:06d}.ply").is_file()]


def copy_site(source, destination, frontend_only=False):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError("Source and destination must be separate sibling directories.")
    for name in REQUIRED_FRONTEND:
        if not (source / name).is_file():
            raise FileNotFoundError(f"Missing frontend file: {source / name}")
    if not frontend_only:
        missing = missing_dataset_files(source)
        if missing:
            raise FileNotFoundError(
                f"Missing {len(missing)} PLY files; first missing: {missing[0]}\n"
                "Copy your redandblack-pages folder into dist/data first.\n"
                "Use --frontend-only only if you deliberately want to update code alone."
            )
    destination.mkdir(parents=True, exist_ok=True)
    for path in source.iterdir():
        if frontend_only and path.name == "data":
            continue
        target = destination / path.name
        if path.is_dir():
            shutil.copytree(path, target, dirs_exist_ok=True)
        else:
            shutil.copy2(path, target)
    (destination / ".nojekyll").touch()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend-only", action="store_true")
    args = parser.parse_args()
    project = Path(__file__).resolve().parent
    source, destination = project / "dist", project / "docs"
    try:
        if not args.frontend_only:
            missing = missing_dataset_files(source)
            if missing:
                raise FileNotFoundError(
                    f"Missing {len(missing)} PLY files; first missing: {missing[0]}\n"
                    "Put your redandblack-pages folder in dist/data, then run again."
                )
        package_source(project)
        copy_site(source, destination, args.frontend_only)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Not prepared: {error}\n")
    print(f"Prepared: {destination}")
    print("Existing data was kept. Next: git add docs && git commit && git push")


if __name__ == "__main__":
    main()
