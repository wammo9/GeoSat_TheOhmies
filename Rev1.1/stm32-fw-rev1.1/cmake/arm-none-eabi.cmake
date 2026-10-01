# Toolchain file for arm-none-eabi-gcc (Cortex-M4F, STM32L4)
#
# The compiler must be on PATH, or set ARM_TOOLCHAIN_DIR to its bin/ folder, e.g.
#   export ARM_TOOLCHAIN_DIR=/Applications/ArmGNUToolchain/14.2.rel1/arm-none-eabi/bin

set(CMAKE_SYSTEM_NAME      Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)

if(DEFINED ENV{ARM_TOOLCHAIN_DIR})
  set(_tc "$ENV{ARM_TOOLCHAIN_DIR}/")
else()
  set(_tc "")
endif()

set(CMAKE_C_COMPILER   ${_tc}arm-none-eabi-gcc)
set(CMAKE_CXX_COMPILER ${_tc}arm-none-eabi-g++)
set(CMAKE_ASM_COMPILER ${_tc}arm-none-eabi-gcc)
set(CMAKE_OBJCOPY      ${_tc}arm-none-eabi-objcopy CACHE FILEPATH "")
set(CMAKE_SIZE         ${_tc}arm-none-eabi-size    CACHE FILEPATH "")

# Can't link a test executable without a linker script
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

set(MCU_FLAGS "-mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard")

set(CMAKE_C_FLAGS_INIT   "${MCU_FLAGS} -ffunction-sections -fdata-sections -fno-common")
set(CMAKE_ASM_FLAGS_INIT "${MCU_FLAGS} -x assembler-with-cpp")
# nano.specs = small newlib; nosys.specs = stub syscalls (we provide _write ourselves)
# -u _printf_float lets printf("%f") work with newlib-nano
set(CMAKE_EXE_LINKER_FLAGS_INIT
    "${MCU_FLAGS} --specs=nano.specs --specs=nosys.specs -Wl,--gc-sections -u _printf_float -Wl,--no-warn-rwx-segments")

set(CMAKE_C_FLAGS_DEBUG_INIT   "-Og -g3")
set(CMAKE_C_FLAGS_RELEASE_INIT "-Os -g")

set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
