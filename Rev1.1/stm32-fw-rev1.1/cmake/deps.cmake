# Third-party sources, downloaded once at configure time into build/_deps.
# All pinned to tags so builds are reproducible.
# (macro, not function, so the <name>_SOURCE_DIR variables reach the caller)
#
# SOURCE_SUBDIR points at a folder that doesn't exist so CMake only downloads
# the repos and never runs their own CMakeLists.txt.
#
# Offline / vendored? Point at a local copy instead:
#   cmake --preset debug -DFETCHCONTENT_SOURCE_DIR_CMSIS_CORE=/path/to/cmsis_core

include(FetchContent)

macro(fetch_src name repo tag)
  FetchContent_Declare(${name}
    GIT_REPOSITORY ${repo}
    GIT_TAG        ${tag}
    GIT_SHALLOW    TRUE
    SOURCE_SUBDIR  __no_cmake__)
  FetchContent_MakeAvailable(${name})
endmacro()

# Arm CMSIS core headers (core_cm4.h etc.)
fetch_src(cmsis_core        https://github.com/STMicroelectronics/cmsis_core.git           v5.9.0_20250520)
# STM32L4 device headers, startup files, system_stm32l4xx.c
fetch_src(cmsis_device_l4   https://github.com/STMicroelectronics/cmsis_device_l4.git      v1.7.5)
# We only use the header-only LL drivers from this repo (no HAL)
fetch_src(stm32l4_ll        https://github.com/STMicroelectronics/stm32l4xx_hal_driver.git v1.13.6)
# ST's official platform-independent sensor drivers
fetch_src(lsm6dsox_pid      https://github.com/STMicroelectronics/lsm6dsox-pid.git         v3.3.1)
fetch_src(lis3mdl_pid       https://github.com/STMicroelectronics/lis3mdl-pid.git          v2.2.1)
# Tiny C NMEA parser (replaces TinyGPSPlus)
fetch_src(minmea            https://github.com/kosma/minmea.git                            v1.0.0)
