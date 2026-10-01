/*
 * adc.c - ADC1 single conversions with VREFINT correction.
 *
 * The ESP32 analogReadMilliVolts() used eFuse calibration. The STM32
 * equivalent: measure the internal reference (VREFINT), compare with the
 * factory value stored in flash (VREFINT_CAL, taken at VDDA = 3.0 V), and
 * back out the real VDDA. Readings then stay correct as the supply sags.
 */
#include "adc.h"
#include "board.h"
#include "tick.h"
#include "stm32l4xx_ll_adc.h"

#define ADC_AVG_SAMPLES 8U

static uint32_t adc_convert(uint32_t channel)
{
  LL_ADC_REG_SetSequencerRanks(ADC1, LL_ADC_REG_RANK_1, channel);
  LL_ADC_ClearFlag_EOC(ADC1);
  LL_ADC_REG_StartConversion(ADC1);
  while (!LL_ADC_IsActiveFlag_EOC(ADC1)) { }
  return LL_ADC_REG_ReadConversionData12(ADC1);
}

static uint32_t adc_convert_avg(uint32_t channel)
{
  uint32_t sum = 0;
  for (uint32_t i = 0; i < ADC_AVG_SAMPLES; i++) {
    sum += adc_convert(channel);
  }
  return sum / ADC_AVG_SAMPLES;
}

void adc_init(void)
{
  /* Analog pin */
  LL_AHB2_GRP1_EnableClock(LL_AHB2_GRP1_PERIPH_GPIOA);
  LL_GPIO_SetPinMode(TMP36_PORT, TMP36_PIN, LL_GPIO_MODE_ANALOG);
  LL_GPIO_SetPinPull(TMP36_PORT, TMP36_PIN, LL_GPIO_PULL_NO);

  LL_AHB2_GRP1_EnableClock(LL_AHB2_GRP1_PERIPH_ADC);

  /* Common settings (must be written while the ADC is disabled).
   * Synchronous clock HCLK/2 = 8 MHz, so no PLLSAI1 needed. */
  LL_ADC_SetCommonClock(__LL_ADC_COMMON_INSTANCE(ADC1), LL_ADC_CLOCK_SYNC_PCLK_DIV2);
  LL_ADC_SetCommonPathInternalCh(__LL_ADC_COMMON_INSTANCE(ADC1), LL_ADC_PATH_INTERNAL_VREFINT);

  /* Power up: leave deep power-down, start the regulator (t_ADCVREG_STUP = 20 us) */
  LL_ADC_DisableDeepPowerDown(ADC1);
  LL_ADC_EnableInternalRegulator(ADC1);
  delay_us(LL_ADC_DELAY_INTERNAL_REGUL_STAB_US + 10U);

  /* Offset calibration; ADC must be disabled */
  LL_ADC_StartCalibration(ADC1, LL_ADC_SINGLE_ENDED);
  while (LL_ADC_IsCalibrationOnGoing(ADC1)) { }
  delay_us(10);   /* >= 4 ADC clock cycles before ADEN */

  LL_ADC_SetResolution(ADC1, LL_ADC_RESOLUTION_12B);
  LL_ADC_SetDataAlignment(ADC1, LL_ADC_DATA_ALIGN_RIGHT);
  LL_ADC_REG_SetTriggerSource(ADC1, LL_ADC_REG_TRIG_SOFTWARE);
  LL_ADC_REG_SetContinuousMode(ADC1, LL_ADC_REG_CONV_SINGLE);
  LL_ADC_REG_SetOverrun(ADC1, LL_ADC_REG_OVR_DATA_OVERWRITTEN);
  LL_ADC_REG_SetSequencerLength(ADC1, LL_ADC_REG_SEQ_SCAN_DISABLE);

  /* VREFINT needs >= 4 us sampling; 640.5 cycles @ 8 MHz = 80 us */
  LL_ADC_SetChannelSamplingTime(ADC1, LL_ADC_CHANNEL_VREFINT, LL_ADC_SAMPLINGTIME_640CYCLES_5);
  LL_ADC_SetChannelSamplingTime(ADC1, TMP36_ADC_CH, LL_ADC_SAMPLINGTIME_247CYCLES_5);

  LL_ADC_ClearFlag_ADRDY(ADC1);
  LL_ADC_Enable(ADC1);
  while (!LL_ADC_IsActiveFlag_ADRDY(ADC1)) { }

  delay_us(LL_ADC_DELAY_VREFINT_STAB_US);
}

uint32_t adc_read_vdda_mv(void)
{
  uint32_t raw = adc_convert_avg(LL_ADC_CHANNEL_VREFINT);
  if (raw == 0U) {
    return 3300U;
  }
  return __LL_ADC_CALC_VREFANALOG_VOLTAGE(raw, LL_ADC_RESOLUTION_12B);
}

uint32_t adc_read_channel_mv(uint32_t channel, uint32_t vdda_mv)
{
  uint32_t raw = adc_convert_avg(channel);
  return __LL_ADC_CALC_DATA_TO_VOLTAGE(vdda_mv, raw, LL_ADC_RESOLUTION_12B);
}
