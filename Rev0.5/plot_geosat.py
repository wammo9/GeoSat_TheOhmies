import re
from datetime import datetime

import matplotlib.pyplot as plt
import serial

PORT = "/dev/cu.usbmodem101"  # Replace with your XIAO's port
BAUD = 115200

times, temperatures, voltages, currents = [], [], [], []
latest = {}

fig, (temp_ax, power_ax) = plt.subplots(2, 1, figsize=(10, 7))
plt.ion()

with serial.Serial(PORT, BAUD, timeout=1) as board:
    print(f"Reading {PORT}. Press Ctrl+C to stop.")

    try:
        while True:
            line = board.readline().decode("utf-8", errors="replace").strip()

            if match := re.search(r"TMP36 Temp:\s*([-\d.]+)", line):
                latest["temperature"] = float(match.group(1))

            if match := re.search(
                r"INA219:\s*([-\d.]+) V \|\s*([-\d.]+) mA", line
            ):
                latest["voltage"] = float(match.group(1))
                latest["current"] = float(match.group(2))

            # Blank line marks the end of one complete sensor report.
            if not line and {"temperature", "voltage", "current"} <= latest.keys():
                times.append(datetime.now())
                temperatures.append(latest["temperature"])
                voltages.append(latest["voltage"])
                currents.append(latest["current"])
                latest.clear()

                temp_ax.clear()
                temp_ax.plot(times, temperatures, "o-", color="firebrick")
                temp_ax.set_ylabel("Temperature (°C)")
                temp_ax.grid(True)

                power_ax.clear()
                power_ax.plot(times, voltages, "o-", label="Voltage (V)")
                power_ax.plot(times, currents, "o-", label="Current (mA)")
                power_ax.set_ylabel("INA219 readings")
                power_ax.set_xlabel("Time")
                power_ax.legend()
                power_ax.grid(True)

                fig.autofmt_xdate()
                plt.tight_layout()
                plt.pause(0.01)

    except KeyboardInterrupt:
        print("\nStopped.")