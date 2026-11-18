#!/usr/bin/env python3
"""Pick which HIL result folders go into git.

hil/results/ stays git-ignored so rehearsals and --port sim runs don't pile up
in the repo. This script stages only the folders you name (git add -f), so the
runs you'd actually show someone get committed.

    python commit_results.py --list                          # every run, size, committed or not
    python commit_results.py gps_20261029_114956 magnoise_20261105_112229
    python commit_results.py ../../stm32-fw-rev2.3/hil/results/magnoise_20261105_112229
    python commit_results.py magnoise_20261105_112229 -m "RM3100 noise, floor, GPS off"

Names are looked up in this folder's results/; a path works too (another rev's run,
say). Without -m it only stages: review with `git status`, then commit yourself.
Only needs Python and git (no venv required).
"""
import argparse
import subprocess
import sys
from pathlib import Path

RESULTS = Path(__file__).resolve().parent / "results"
BIG_MB = 20.0   # warn above this; GitHub refuses single files over 100 MB


def git(*args, cwd=None, check=True):
    return subprocess.run(["git", *args], cwd=cwd, check=check, capture_output=True, text=True)


def repo_root(start: Path) -> Path:
    try:
        return Path(git("rev-parse", "--show-toplevel", cwd=start).stdout.strip())
    except (subprocess.CalledProcessError, FileNotFoundError):
        sys.exit(f"{start} isn't inside a git repository (or git isn't installed).")


def size_mb(folder: Path) -> float:
    return sum(f.stat().st_size for f in folder.rglob("*") if f.is_file()) / 1e6


def is_tracked(folder: Path, root: Path) -> bool:
    out = git("ls-files", "--", str(folder.relative_to(root)), cwd=root).stdout
    return bool(out.strip())


def resolve(name: str) -> Path:
    p = Path(name).expanduser()
    for cand in (p, RESULTS / name):
        if cand.is_dir():
            return cand.resolve()
    sys.exit(f"No result folder '{name}' (looked in {RESULTS} and as a path). Try --list.")


def list_runs(root: Path) -> None:
    runs = sorted((d for d in RESULTS.iterdir() if d.is_dir()), key=lambda d: d.name) if RESULTS.is_dir() else []
    if not runs:
        print(f"No runs in {RESULTS}")
        return
    print(f"{'run':<34}{'MB':>8}  committed")
    for d in runs:
        print(f"{d.name:<34}{size_mb(d):8.1f}  {'yes' if is_tracked(d, root) else '-'}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("runs", nargs="*", help="result folder names (or paths) to stage")
    p.add_argument("--list", action="store_true", help="list runs in results/ and whether they're committed")
    p.add_argument("-m", "--message", help="also commit the staged runs with this message")
    args = p.parse_args()

    root = repo_root(RESULTS.parent)
    if args.list or not args.runs:
        list_runs(root)
        if not args.runs:
            return

    staged = []
    for name in args.runs:
        folder = resolve(name)
        mb = size_mb(folder)
        if mb > BIG_MB:
            print(f"  ! {folder.name} is {mb:.0f} MB: fine for git, but check it's the run you meant")
        git("add", "-f", "--", str(folder.relative_to(root)), cwd=root)
        staged.append(folder)
        print(f"  staged {folder.relative_to(root)}  ({mb:.1f} MB)")

    if args.message:
        res = git("commit", "-m", args.message, "--", *[str(f.relative_to(root)) for f in staged],
                  cwd=root, check=False)
        print(res.stdout.strip() or res.stderr.strip())
        if res.returncode == 0:
            print("Committed. Run `git push` to upload.")
    else:
        print("\nStaged only. Check `git status`, then `git commit -m \"...\"` and `git push`.")


if __name__ == "__main__":
    main()