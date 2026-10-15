"""Fake Rev 1 board for rehearsing the test scripts without hardware.

Use --port sim on any script. It speaks the same serial protocol as the HIL
firmware and produces plausible (deliberately imperfect) sensor data:
small accel offsets/scale errors, hard/soft-iron magnetometer distortion,
a GPS that takes a few seconds to get a fix, etc. Each new START of a stream
advances the simulated scenario (next accel orientation, next temp condition,
next GPS location) in the same order the scripts ask for them.
"""
from __future__ import annotations

import math
import time

import numpy as np

_ORIENT_UP = [(0, 0, 1), (0, 0, -1), (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0)]
_TEMP_SCENES = [(23.5, 0.0), (14.0, 0.0), (26.0, 0.9)]  # (start C, ramp C/s)
_GPS_SITES = [(40.00700, -105.26340), (40.00930, -105.27050), (40.00470, -105.26960)]


def _rot(rx, ry, rz):
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


class SimTransport:
    PERIODS = {"IMU": 20, "MAG": 20, "TMP": 100, "PWR": 100, "GPS": 1000}

    def __init__(self, speed: float = 1.0):
        self.rng = np.random.default_rng(7)
        self.t0 = time.time()
        self.out: list[str] = []
        self.active: dict[str, list[float]] = {}  # kind -> [period_ms, next_due_ms]
        self.starts = {k: 0 for k in self.PERIODS}
        self.stream_t0 = {k: 0.0 for k in self.PERIODS}
        self.inbuf = ""
        # error model
        self.acc_off = np.array([0.012, -0.018, 0.030])          # g
        self.acc_scale = np.array([1.004, 0.996, 1.010])
        self.hard_iron = np.array([18.0, -9.0, 31.0])            # uT
        self.soft_iron = np.array([[1.06, 0.03, 0.0], [0.03, 0.95, 0.02], [0.0, 0.02, 1.02]])
        self.earth = np.array([21.5, 4.3, 47.2])                 # ~52 uT, inclination ~65 deg
        self.gps_site = _GPS_SITES[0]
        self.gps_err = np.zeros(2)

    # --- serial-like API
    def now_ms(self) -> float:
        return (time.time() - self.t0) * 1000.0

    def write(self, data: bytes) -> None:
        self.inbuf += data.decode()
        while "\n" in self.inbuf:
            line, self.inbuf = self.inbuf.split("\n", 1)
            self._cmd(line.strip().upper())

    def flush(self) -> None:
        pass

    def reset_input_buffer(self) -> None:
        self.out.clear()

    def close(self) -> None:
        pass

    def readline(self) -> bytes:
        if not self.out:
            self._generate()
        if self.out:
            return (self.out.pop(0) + "\n").encode()
        time.sleep(0.002)
        return b""

    # --- protocol
    def _cmd(self, line: str) -> None:
        parts = line.split()
        if not parts:
            return
        c = parts[0]
        if c == "PING":
            self.out.append("#PONG")
        elif c == "INFO":
            self.out.append("#INFO,fw=sim,lsm=0x6A,lis=0x1C,ina=0x40;0x41,gps_chars=12345,gps_fail_cs=0")
        elif c == "SCAN":
            self.out += ["#SCAN,0x1C,0x40,0x41,0x6A", "#SCAN_DONE,4"]
        elif c == "STOP":
            self.active.clear()
            self.out.append("#ACK,STOP")
        elif c == "START" and len(parts) >= 2:
            kinds = list(self.PERIODS) if parts[1] == "ALL" else [parts[1]]
            for k in kinds:
                if k not in self.PERIODS:
                    self.out.append(f"#ERR,BADSTREAM,{k}")
                    continue
                period = int(parts[2]) if len(parts) > 2 else self.PERIODS[k]
                self.active[k] = [period, self.now_ms()]
                self.stream_t0[k] = self.now_ms()
                self._on_start(k)
                self.starts[k] += 1
                self.out.append(f"#ACK,START,{k},{period}")
        else:
            self.out.append(f"#ERR,UNKNOWN,{c}")

    def _on_start(self, k: str) -> None:
        if k == "GPS":
            self.gps_site = _GPS_SITES[self.starts[k] % len(_GPS_SITES)]
            self.gps_err = self.rng.normal(0, 2.0, 2)

    def _generate(self) -> None:
        now = self.now_ms()
        for k, st in self.active.items():
            period, due = st
            if now >= due:
                st[1] = due + period if now - due < 5 * period else now + period
                self.out += self._sample(k, now)

    # --- physics-ish models
    def _sample(self, k: str, t: float) -> list[str]:
        rng = self.rng
        ts = (t - self.stream_t0[k]) / 1000.0
        if k == "IMU":
            up = np.array(_ORIENT_UP[(self.starts[k] - 1) % 6], float)
            a = (up * self.acc_scale + self.acc_off + rng.normal(0, 0.003, 3)) * 9.80665
            g = np.array([0.004, -0.006, 0.002]) + rng.normal(0, 0.0015, 3)
            return [f"$IMU,{t:.0f},{a[0]:.4f},{a[1]:.4f},{a[2]:.4f},{g[0]:.5f},{g[1]:.5f},{g[2]:.5f},{29.5:.2f}"]
        if k == "MAG":
            R = _rot(0.9 * ts, 0.53 * ts + 0.4 * math.sin(0.21 * ts), 0.31 * ts)
            m = self.soft_iron @ (R.T @ self.earth) + self.hard_iron + rng.normal(0, 0.15, 3)
            return [f"$MAG,{t:.0f},{m[0]:.3f},{m[1]:.3f},{m[2]:.3f}"]
        if k == "TMP":
            base, ramp = _TEMP_SCENES[(self.starts[k] - 1) % len(_TEMP_SCENES)]
            temp = base + ramp * ts + rng.normal(0, 0.25)
            if ramp:
                temp = min(temp, 70.0)
            mv = temp * 10 + 500
            return [f"$TMP,{t:.0f},{mv:.1f},{temp:.2f},{temp + 4.0:.2f}"]
        if k == "PWR":
            i = 72 + 18 * (math.sin(ts * 2) > 0.7) + rng.normal(0, 0.8)
            v = 4.96 + rng.normal(0, 0.005)
            g = 28 + rng.normal(0, 0.5)  # GPS rail
            return [f"$PWR,{t:.0f},0x40,{v:.3f},{i * 0.1:.3f},{i:.2f},{i * v:.2f}",
                    f"$PWR,{t:.0f},0x41,{v:.3f},{g * 0.1:.3f},{g:.2f},{g * v:.2f}"]
        if k == "GPS":
            if ts < 4:
                return [f"$GPS,{t:.0f},0,nan,nan,nan,{int(ts)},nan,-1,,{int(9000 + ts * 600)}"]
            self.gps_err = 0.92 * self.gps_err + rng.normal(0, 0.6, 2)
            lat0, lon0 = self.gps_site
            lat = lat0 + (self.gps_err[1] + 1.5) / 111_320
            lon = lon0 + (self.gps_err[0] - 1.0) / (111_320 * math.cos(math.radians(lat0)))
            sats = 9 + int(rng.integers(-1, 2))
            utc = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            return [f"$GPS,{t:.0f},1,{lat:.7f},{lon:.7f},{1655 + rng.normal(0, 3):.2f},{sats},"
                    f"{0.9 + rng.random() * 0.4:.2f},{int(rng.integers(50, 900))},{utc},{int(9000 + ts * 600)}"]
        return []