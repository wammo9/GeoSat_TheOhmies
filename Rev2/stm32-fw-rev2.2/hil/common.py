"""Shared plumbing for the Rev 2 hardware-in-the-loop test scripts.

Talks to the HIL firmware (geosat_hil, src/app/hil.c) over the ST-LINK USB
serial port, captures the '$'-prefixed data streams into lists of dicts,
writes CSVs, and provides the small prompt / plotting helpers every test
script uses. Same protocol as the Rev 1 (XIAO ESP32-C6) suite; the TMP and GPS
lines changed for the TMP117 and SAM-M10Q.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from datetime import datetime
from pathlib import Path

HIL_DIR = Path(__file__).resolve().parent
RESULTS_ROOT = HIL_DIR / "results"
G = 9.80665  # m/s^2 per g
BOARD = "Rev 2"  # used in report titles

# Field names for each data line the firmware emits (after the "$TYPE," prefix)
FIELDS = {
    "IMU": ["t_ms", "ax", "ay", "az", "gx", "gy", "gz", "die_c"],
    "MAG": ["t_ms", "mx", "my", "mz"],
    # TMP117: raw = result register (1/128 C per LSB); fresh = 1 if a new conversion
    "TMP": ["t_ms", "raw", "temp_c", "die_c", "fresh"],
    "PWR": ["t_ms", "addr", "bus_v", "shunt_mv", "current_ma", "power_mw"],
    # SAM-M10Q, from UBX-NAV-PVT: fix_type 0 none / 2 2D / 3 3D; h_acc/v_acc = receiver's
    # own 1-sigma accuracy estimate; itow_ms = GPS time of week (one value per epoch)
    "GPS": ["t_ms", "valid", "lat", "lon", "alt_m", "sats", "fix_type", "h_acc_m", "v_acc_m",
            "pdop", "fix_age_ms", "utc", "itow_ms", "chars", "ubx_frames", "ubx_err", "link_err"],
}
STR_FIELDS = {"addr", "utc"}
ST_LINK_USB_VID = 0x0483     # STMicroelectronics (Nucleo ST-LINK virtual COM port)
ESPRESSIF_USB_VID = 0x303A   # Rev 1 XIAO, in case it's still plugged in


# --------------------------------------------------------------------------- parsing
def _num(s: str) -> float:
    try:
        return float(s)
    except ValueError:
        return math.nan


def parse_line(line: str):
    """'$IMU,123,...' -> ('IMU', {'t_ms': 123.0, ...}); None for anything else."""
    if not line.startswith("$"):
        return None
    parts = line[1:].split(",")
    kind = parts[0]
    names = FIELDS.get(kind)
    if names is None or len(parts) - 1 != len(names):
        return None
    rec = {}
    for name, raw in zip(names, parts[1:]):
        rec[name] = raw if name in STR_FIELDS else _num(raw)
    return kind, rec


# --------------------------------------------------------------------------- device
class DeviceError(RuntimeError):
    pass


def find_port() -> str:
    from serial.tools import list_ports  # pyserial

    ports = list(list_ports.comports())
    stlink = [p for p in ports if p.vid == ST_LINK_USB_VID]
    if len(stlink) == 1:
        return stlink[0].device
    candidates = stlink or [p for p in ports if ("usbmodem" in p.device or "ttyACM" in p.device)
                            and p.vid != ESPRESSIF_USB_VID]
    if len(candidates) == 1:
        return candidates[0].device
    listing = "\n".join(f"  {p.device}  {p.description}" for p in ports) or "  (none)"
    raise DeviceError(
        "Couldn't pick the Nucleo's ST-LINK serial port automatically. Pass --port.\n"
        f"Ports seen:\n{listing}"
    )


class HilDevice:
    """Command/stream client for the HIL firmware.

    port="sim" uses the built-in simulator (sim_device.py) so scripts can be
    rehearsed without hardware.
    """

    def __init__(self, port: str | None = None, baud: int = 115200):
        if port == "sim":
            from sim_device import SimTransport

            self.ser = SimTransport()
            self.port = "sim"
        else:
            import serial  # pyserial

            self.port = port or find_port()
            self.ser = serial.Serial(self.port, baud, timeout=0.1)
            time.sleep(0.3)
        self.ser.reset_input_buffer()
        # The firmware may still be in its boot sequence (SAM-M10Q config can take ~3 s)
        for attempt in range(3):
            try:
                self.command("STOP", timeout=2.0 if attempt < 2 else 4.0)
                break
            except DeviceError:
                if attempt == 2:
                    raise
        self.info = self.get_info()

    # -- low level
    def send(self, line: str) -> None:
        self.ser.write((line.strip() + "\n").encode())
        self.ser.flush()

    def readline(self) -> str | None:
        raw = self.ser.readline()
        if not raw:
            return None
        return raw.decode(errors="replace").strip()

    def command(self, cmd: str, expect: tuple[str, ...] = ("#ACK", "#ERR", "#PONG", "#INFO"),
                timeout: float = 2.0) -> str:
        """Send a command and return the first matching '#' response line."""
        self.send(cmd)
        deadline = time.time() + timeout
        while time.time() < deadline:
            line = self.readline()
            if line and line.startswith(expect):
                if line.startswith("#ERR"):
                    raise DeviceError(f"{cmd!r} -> {line}")
                return line
        raise DeviceError(f"No response to {cmd!r} within {timeout}s (is the HIL firmware flashed?)")

    def get_info(self) -> dict:
        line = self.command("INFO", expect=("#INFO",))
        info = {}
        for kv in line.split(",")[1:]:
            if "=" in kv:
                k, v = kv.split("=", 1)
                info[k] = v
        return info

    def has(self, kind: str) -> bool:
        key = {"IMU": "lsm", "MAG": "lis", "PWR": "ina", "TMP": "tmp", "GPS": "gps"}.get(kind)
        return key is None or self.info.get(key, "none") != "none"

    def gps_restart(self, mode: str) -> str:
        """Hot/warm/cold-start the SAM-M10Q (UBX-CFG-RST) and wait for it to be reconfigured.

        Returns the firmware's '#OK,GPSCFG...' or '#WARN,GPSCFG...' line."""
        mode = mode.upper()
        if mode not in ("HOT", "WARM", "COLD"):
            raise ValueError(mode)
        return self.command(f"GPSRST {mode}", expect=("#OK,GPSCFG", "#WARN,GPSCFG", "#ERR"),
                            timeout=8.0)

    def scan(self) -> list[str]:
        self.send("SCAN")
        found: list[str] = []
        deadline = time.time() + 5
        while time.time() < deadline:
            line = self.readline()
            if not line:
                continue
            if line.startswith("#SCAN_DONE"):
                return found
            if line.startswith("#SCAN"):
                found = [a for a in line.split(",")[1:] if a]
        raise DeviceError("I2C scan timed out")

    # -- streaming
    def stream(self, sensors: dict[str, int | None], duration_s: float,
               status_fn=None, on_sample=None, quiet: bool = False,
               stop_when=None) -> dict[str, list[dict]]:
        """Run the given streams ({'IMU': 20, 'MAG': None}) for duration_s seconds.

        Every record gets 'host_t' (seconds since capture start). status_fn(data)
        returns a short string appended to the progress line. stop_when(data)
        returning True ends the capture early.
        """
        data: dict[str, list[dict]] = {k: [] for k in sensors}
        for kind, period in sensors.items():
            if not self.has(kind):
                raise DeviceError(f"{kind} sensor was not detected by the firmware ({self.info})")
            self.command(f"START {kind} {period or ''}".strip())
        t0 = time.time()
        last_draw = 0.0
        try:
            while True:
                now = time.time()
                elapsed = now - t0
                if elapsed >= duration_s or (stop_when and stop_when(data)):
                    break
                line = self.readline()
                if line:
                    parsed = parse_line(line)
                    if parsed and parsed[0] in data:
                        kind, rec = parsed
                        rec["host_t"] = round(now - t0, 4)
                        data[kind].append(rec)
                        if on_sample:
                            on_sample(kind, rec)
                if not quiet and now - last_draw > 0.25:
                    last_draw = now
                    extra = f" | {status_fn(data)}" if status_fn else ""
                    counts = " ".join(f"{k}:{len(v)}" for k, v in data.items())
                    remaining = max(0.0, duration_s - elapsed)
                    print(f"\r  {progress_bar(elapsed / duration_s)} {remaining:5.1f}s left  "
                          f"[{counts}]{extra}\033[K", end="", flush=True)
        finally:
            self.stop()
            if not quiet:
                print()
        return data

    def stop(self) -> None:
        try:
            self.command("STOP", expect=("#ACK,STOP",))
        except DeviceError:
            pass
        time.sleep(0.05)
        self.ser.reset_input_buffer()

    def close(self) -> None:
        self.stop()
        self.ser.close()


# --------------------------------------------------------------------------- UI helpers
def progress_bar(frac: float, width: int = 24) -> str:
    frac = min(max(frac, 0.0), 1.0)
    n = int(round(frac * width))
    return "[" + "#" * n + "-" * (width - n) + "]"


def banner(title: str) -> None:
    print("\n" + "=" * 64 + f"\n  {title}\n" + "=" * 64)


def wait_for_enter(msg: str) -> str:
    """Show instructions; return what the user typed (lowercased) when they hit Enter."""
    try:
        return input(f"\n{msg}\n  >> Press Enter when ready (q to quit): ").strip().lower()
    except EOFError:
        return "q"


def ask(msg: str, default: str = "") -> str:
    try:
        ans = input(f"  {msg}{f' [{default}]' if default else ''}: ").strip()
    except EOFError:
        ans = ""
    return ans or default


def ask_float(msg: str, allow_blank: bool = True) -> float | None:
    while True:
        ans = ask(msg)
        if not ans and allow_blank:
            return None
        try:
            return float(ans)
        except ValueError:
            print("    (enter a number, or leave blank to skip)")


def ask_yes(msg: str, default: bool = True) -> bool:
    ans = ask(f"{msg} ({'Y/n' if default else 'y/N'})").lower()
    return default if not ans else ans.startswith("y")


def countdown(seconds: float, label: str = "Hold still") -> None:
    end = time.time() + seconds
    while (left := end - time.time()) > 0:
        print(f"\r  {label}... starting in {left:3.1f}s\033[K", end="", flush=True)
        time.sleep(0.1)
    print()


# --------------------------------------------------------------------------- files
def make_results_dir(test_name: str, out: str | None = None) -> Path:
    path = Path(out) if out else RESULTS_ROOT / f"{test_name}_{datetime.now():%Y%m%d_%H%M%S}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_csv(path: Path, rows: list[dict], fields: list[str] | None = None) -> Path:
    if fields is None:
        fields = []
        for r in rows:
            fields.extend(k for k in r if k not in fields)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return path


def read_csv(path: Path) -> list[dict]:
    rows = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            rows.append({k: (v if k in STR_FIELDS or k in ("label", "location", "orientation")
                             else _num(v)) for k, v in r.items()})
    return rows


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2, default=float))


class Report:
    """Collects PASS/FAIL checks and free text; prints and saves report.txt."""

    def __init__(self, title: str):
        self.title = title
        self.lines: list[str] = []
        self.checks: list[tuple[str, bool, str]] = []

    def note(self, text: str = "") -> None:
        self.lines.append(text)

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        self.checks.append((name, bool(ok), detail))
        return ok

    @property
    def passed(self) -> bool:
        return all(ok for _, ok, _ in self.checks)

    def render(self) -> str:
        out = [f"{self.title}", f"generated {datetime.now():%Y-%m-%d %H:%M:%S}", ""]
        out += self.lines
        if self.checks:
            out += ["", "CHECKS"]
            w = max(len(n) for n, _, _ in self.checks)
            for name, ok, detail in self.checks:
                out.append(f"  [{'PASS' if ok else 'FAIL'}] {name:<{w}}  {detail}")
            out += ["", f"OVERALL: {'PASS' if self.passed else 'FAIL'}"]
        return "\n".join(out)

    def save(self, outdir: Path) -> None:
        text = self.render()
        (outdir / "report.txt").write_text(text + "\n")
        print("\n" + text)


# --------------------------------------------------------------------------- plotting
def plt_setup(show: bool):
    import matplotlib

    if not show:
        matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update({"figure.dpi": 110, "axes.grid": True, "grid.alpha": 0.3,
                         "axes.spines.top": False, "axes.spines.right": False})
    return plt


def save_fig(fig, path: Path) -> None:
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    print(f"  saved {path.name}")


# --------------------------------------------------------------------------- CLI
def base_parser(description: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=description)
    p.add_argument("--port", help="serial port (auto-detected if omitted; 'sim' = simulator)")
    p.add_argument("--out", help="results directory (default: hil/results/<test>_<timestamp>)")
    p.add_argument("--no-show", action="store_true", help="save plots without opening windows")
    return p


Rev1Device = HilDevice  # old name, kept so older scripts still import


def open_device(args) -> HilDevice:
    try:
        dev = HilDevice(args.port)
    except DeviceError as e:
        sys.exit(f"ERROR: {e}")
    print(f"Connected on {dev.port}: {dev.info}")
    return dev


def col(rows: list[dict], key: str):
    import numpy as np

    return np.array([r[key] for r in rows], dtype=float)
