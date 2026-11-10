"""Check the firmware's data lines against hil/common.py's FIELDS (field count + values)."""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "hil"))
from common import FIELDS, parse_line  # noqa: E402

lines = Path(sys.argv[1]).read_text().splitlines()
recs = []
for line in lines:
    parsed = parse_line(line)
    assert parsed, f"python couldn't parse: {line!r} (expected {len(FIELDS[line[1:4]])} fields)"
    recs.append(parsed)
    print(f"  ok  {line}")

kinds = [k for k, _ in recs]
assert kinds == ["IMU", "MAG", "RMG", "TMP", "TMP", "TMP", "PWR", "GPS", "GPS", "GPS"], kinds
imu, mag, rmg, t1, t2, t3, pwr, g0, g1, g2 = [r for _, r in recs]
assert abs(rmg["mz"] - 47.0133) < 1e-4 and rmg["fresh"] == 1
assert abs(imu["az"] - 9.8066) < 1e-4 and imu["die_c"] == 29.5
assert abs(t1["temp_c"] - 2993 / 128) < 1e-4 and t1["fresh"] == 1 and t1["raw"] == 2993
assert t2["temp_c"] == -10.0 and math.isnan(t2["die_c"]) and t2["fresh"] == 0
assert math.isnan(t3["temp_c"]) and math.isnan(t3["raw"])
assert pwr["addr"] == "0x41" and pwr["current_ma"] == 31.2
assert g0["valid"] == 0 and math.isnan(g0["lat"]) and g0["fix_age_ms"] == -1 and g0["utc"] == ""
assert g1["valid"] == 0 and g1["fix_age_ms"] == 100 and g1["link_err"] == 1 and g1["itow_ms"] == 345600000
assert g2["valid"] == 1 and g2["fix_type"] == 3 and abs(g2["lat"] - 40.0071234) < 1e-7
assert g2["utc"] == "2026-10-29T16:05:09Z" and g2["fix_age_ms"] == 200 and g2["h_acc_m"] == 1.25
print("check_lines: every line matches hil/common.py")
