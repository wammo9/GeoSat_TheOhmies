cmake_minimum_required(VERSION 3.22)

project(geosat_fw C ASM)

set(CMAKE_C_STANDARD 11)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Dev board = STM32L432xx (NUCLEO-L432KC). Flight board = STM32L433xx.
# Same core, 256K flash / 64K RAM, so only the define + startup file change.
set(MCU_DEVICE "STM32L432xx" CACHE STRING "STM32L432xx or STM32L433xx")
set_property(CACHE MCU_DEVICE PROPERTY STRINGS STM32L432xx STM32L433xx)
string(TOLOWER ${MCU_DEVICE} MCU_DEVICE_LC)

include(cmake/deps.cmake)

set(LINKER_SCRIPT ${CMAKE_SOURCE_DIR}/linker/stm32l43x_flash.ld)

# ---------------------------------------------------------------------------
# Common include paths / defines for everything
# ---------------------------------------------------------------------------
add_library(fw_config INTERFACE)
target_compile_definitions(fw_config INTERFACE ${MCU_DEVICE})
target_include_directories(fw_config INTERFACE
  ${cmsis_core_SOURCE_DIR}/Include
  ${cmsis_device_l4_SOURCE_DIR}/Include
  ${stm32l4_ll_SOURCE_DIR}/Inc
  ${lsm6dsox_pid_SOURCE_DIR}
  ${lis3mdl_pid_SOURCE_DIR}
  ${minmea_SOURCE_DIR}
  ${CMAKE_SOURCE_DIR}/src
  ${CMAKE_SOURCE_DIR}/src/platform
  ${CMAKE_SOURCE_DIR}/src/drivers)

# OBJECT libraries (not STATIC) so strong IRQ handlers like USART1_IRQHandler
# always override the weak aliases in the startup file.

# Startup, clock, timing, debug UART. Enough for blink.
add_library(platform OBJECT
  ${cmsis_device_l4_SOURCE_DIR}/Source/Templates/gcc/startup_${MCU_DEVICE_LC}.s
  ${cmsis_device_l4_SOURCE_DIR}/Source/Templates/system_stm32l4xx.c
  src/platform/clock.c
  src/platform/tick.c
  src/platform/debug_uart.c
  src/platform/syscalls.c)
target_link_libraries(platform PUBLIC fw_config)

# Peripherals + sensor drivers for the full firmware
add_library(peripherals OBJECT
  src/platform/i2c.c
  src/platform/adc.c
  src/platform/gps_uart.c
  src/drivers/imu.c
  src/drivers/ina219.c
  src/drivers/gps.c)
target_link_libraries(peripherals PUBLIC fw_config)

set(FW_WARNINGS -Wall -Wextra -Wshadow -Wno-unused-parameter)
target_compile_options(platform    PRIVATE ${FW_WARNINGS})
target_compile_options(peripherals PRIVATE ${FW_WARNINGS})

# Third-party code, built without our warning flags
add_library(thirdparty OBJECT
  ${lsm6dsox_pid_SOURCE_DIR}/lsm6dsox_reg.c
  ${lis3mdl_pid_SOURCE_DIR}/lis3mdl_reg.c
  ${minmea_SOURCE_DIR}/minmea.c)
target_link_libraries(thirdparty PUBLIC fw_config)
# newlib has no timegm(); minmea's README suggests this substitution
set_source_files_properties(${minmea_SOURCE_DIR}/minmea.c
  PROPERTIES COMPILE_DEFINITIONS "timegm=mktime")

# ---------------------------------------------------------------------------
# Firmware images
# ---------------------------------------------------------------------------
function(add_firmware name)
  add_executable(${name} ${ARGN})
  set_target_properties(${name} PROPERTIES SUFFIX ".elf")
  target_compile_options(${name} PRIVATE ${FW_WARNINGS})
  target_link_options(${name} PRIVATE
    -T${LINKER_SCRIPT}
    -Wl,-Map=$<TARGET_FILE_DIR:${name}>/${name}.map,--cref
    -Wl,--print-memory-usage)
  set_target_properties(${name} PROPERTIES LINK_DEPENDS ${LINKER_SCRIPT})
  add_custom_command(TARGET ${name} POST_BUILD
    COMMAND ${CMAKE_OBJCOPY} -O binary $<TARGET_FILE:${name}> $<TARGET_FILE_DIR:${name}>/${name}.bin
    COMMAND ${CMAKE_OBJCOPY} -O ihex   $<TARGET_FILE:${name}> $<TARGET_FILE_DIR:${name}>/${name}.hex
    COMMAND ${CMAKE_SIZE} $<TARGET_FILE:${name}>
    VERBATIM)
endfunction()

# Step 1: toolchain / flashing / clock / printf sanity check
add_firmware(blink src/app/blink.c)
target_link_libraries(blink PRIVATE platform)

# Step 2: the ported sensor firmware
add_firmware(geosat_fw src/app/main.c)
target_link_libraries(geosat_fw PRIVATE platform peripherals thirdparty)
