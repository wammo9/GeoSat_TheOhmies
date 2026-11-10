"""Fake Rev 2 board (Nucleo + breakouts) for rehearsing the test scripts without hardware.

Use --port sim on any script. It speaks the same serial protocol as the HIL
firmware and produces plausible (deliberately imperfect) sensor data:
small accel offsets/scale errors, hard/soft-iron magnetometer distortion,
a TMP117 that only converts every 500 ms, a SAM-M10Q that takes a few seconds
to get a fix (longer after GPSRST COLD), etc. Each new START of a stream
advances the simulated scenario (next accel orientation, next temp condition,
next GPS location) in the same order the scripts ask for them.
"""
from __future__ import annotations

import math
import os
import time

import numpy as np

_ORIENT_UP = [(0, 0, 1), (0, 0, -1), (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0)]
_TEMP_SCENES = [(23.5, 0.0), (14.0, 0.0), (26.0, 0.25)]  # (start C, ramp C/s)
_GPS_SITES = [(40.00700, -105.26340), (40.00930, -105.27050), (40.00470, -105.26960)]


def _rot(rx, ry, rz):
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


class SimTransport:
    PERIODS = {"IMU": 20, "MAG": 20, "TMP": 250, "PWR": 100, "GPS": 1000, "RMG": 20}  # firmware defaults

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
        self.rm_hard = np.array([-6.0, 11.0, 4.0])              # RM3100 sits elsewhere on the bench
        self.rm_soft = np.array([[1.01, 0.01, 0.0], [0.01, 0.99, 0.0], [0.0, 0.0, 1.0]])
        self.gps_site = _GPS_SITES[0]
        self.gps_err = np.zeros(2)
        self.gps_acq_s = 4.0          # time to fix after the next GPS stream starts
        self.gps_chars = 0
        self.gps_frames = 0

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
            self.out.append("#INFO,fw=sim,mcu=STM32L432,lsm=0x6A,lis=0x1C,tmp=0x48,rm=0x20,rm_revid=0x22,gps=0x42,gps_cfg=ack,"
                            f"ina=0x40,gps_chars={self.gps_chars},gps_ubx={self.gps_frames},"
                            "gps_link_err=0,read_err=0,rx_ovf=0")
        elif c == "SCAN":
            self.out += ["#SCAN,0x1C,0x20,0x40,0x42,0x48,0x6A", "#SCAN_DONE,6"]
        elif c == "BUS":
            self.active.clear()
            self.out += ["#BUS,SDA,PB7,pd=1,pu=1,PULLED_UP", "#BUS,SCL,PB6,pd=1,pu=1,PULLED_UP", "#BUS_DONE"]
        elif c == "REINIT":
            self.active.clear()
            self.out += ["#I2C,recovery_pulses=0", "#OK,LSM6DSOX,0x6A", "#OK,LIS3MDL,0x1C",
                         "#OK,RM3100,0x20,revid=0x22",
                         "#OK,TMP117,0x48", "#OK,INA219,0x40", "#OK,SAM-M10Q,I2C1 @ 0x42 (D4/D5),UBX ACK"]
            self._cmd("INFO")
            self.out.append("#ACK,REINIT")
        elif c == "GPSRST" and len(parts) >= 2 and parts[1] in ("HOT", "WARM", "COLD"):
            self.gps_acq_s = {"HOT": 2.0, "WARM": 12.0, "COLD": 27.0}[parts[1]]
            self.out += [f"#ACK,GPSRST,{parts[1]}", f"#OK,GPSCFG,{parts[1]}"]
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
            self.gps_acq_now = self.gps_acq_s
            self.gps_acq_s = 1.0   # already tracking for the next stream unless restarted
        if k == "TMP":
            self._tmp_conv = None

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
        if k in ("MAG", "RMG"):
            # Tumbling for test_mag; dead still for test_mag_noise (it sets HIL_SIM_MAG=still)
            still = os.environ.get("HIL_SIM_MAG") == "still"
            R = np.eye(3) if still else _rot(0.9 * ts, 0.53 * ts + 0.4 * math.sin(0.21 * ts), 0.31 * ts)
            env = 0.004 * math.sin(2 * math.pi * 0.05 * ts)     # slow 4 nT building drift
            if k == "MAG":   # LIS3MDL: ~0.32 uT rms noise, 1/6842 G steps
                m = self.soft_iron @ (R.T @ self.earth) + self.hard_iron + env + rng.normal(0, 0.32, 3)
                return [f"$MAG,{t:.0f},{m[0]:.3f},{m[1]:.3f},{m[2]:.3f}"]
            # RM3100: ~15 nT rms, 75 counts/uT, new conversion every ~13 ms (75 Hz)
            m = self.rm_soft @ (R.T @ self.earth) + self.rm_hard + env + rng.normal(0, 0.015, 3)
            m = np.round(m * 75) / 75
            return [f"$RMG,{t:.0f},{m[0]:.4f},{m[1]:.4f},{m[2]:.4f},1"]
        if k == "TMP":
            base, ramp = _TEMP_SCENES[(self.starts[k] - 1) % len(_TEMP_SCENES)]
            temp = base + ramp * ts
            if ramp:
                temp = min(temp, 70.0)
            # TMP117: a new 8x-averaged conversion every 500 ms, 1/128 C steps
            conv = int(ts / 0.5)
            fresh = int(conv != getattr(self, "_tmp_conv", None))
            if fresh:
                self._tmp_conv = conv
                self._tmp_raw = int(round((temp + rng.normal(0, 0.01)) * 128))
            raw = self._tmp_raw
            return [f"$TMP,{t:.0f},{raw},{raw / 128:.4f},{raw / 128 + 4.0:.2f},{fresh}"]
        if k == "PWR":
            # one INA219 at 0x40 on the Nucleo's 3V3 feed to the breakouts
            i = 31 + 18 * (math.sin(ts * 2) > 0.7) + rng.normal(0, 0.6)
            v = 3.29 + rng.normal(0, 0.004)
            return [f"$PWR,{t:.0f},0x40,{v:.3f},{i * 0.1:.3f},{i:.2f},{i * v:.2f}"]
        if k == "GPS":
            self.gps_chars += 190
            self.gps_frames += 1
            tail = f"{self.gps_chars},{self.gps_frames},0,0"
            itow = int(time.time() * 1000) % 604_800_000 // 1000 * 1000
            if ts < getattr(self, "gps_acq_now", 4.0):
                return [f"$GPS,{t:.0f},0,nan,nan,nan,{int(ts) % 6},0,{9000 - ts * 100:.2f},"
                        f"{9000 - ts * 100:.2f},99.99,{int(rng.integers(50, 900))},,{itow},{tail}"]
            self.gps_err = 0.92 * self.gps_err + rng.normal(0, 0.4, 2)
            lat0, lon0 = self.gps_site
            lat = lat0 + (self.gps_err[1] + 0.8) / 111_320
            lon = lon0 + (self.gps_err[0] - 0.5) / (111_320 * math.cos(math.radians(lat0)))
            sats = 14 + int(rng.integers(-2, 3))
            hacc = 1.2 + 4.0 * math.exp(-(ts - self.gps_acq_now) / 20) + rng.random() * 0.2
            utc = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            return [f"$GPS,{t:.0f},1,{lat:.7f},{lon:.7f},{1655 + rng.normal(0, 3):.2f},{sats},3,"
                    f"{hacc:.2f},{hacc * 1.6:.2f},{1.2 + rng.random() * 0.3:.2f},"
                    f"{int(rng.integers(50, 900))},{utc},{itow},{tail}"]
        return []
