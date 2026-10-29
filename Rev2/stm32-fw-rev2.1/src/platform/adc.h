#ifndef ADC_H
#define ADC_H

#include <stdint.h>

void     adc_init(void);
/* Actual VDDA in mV, measured against the factory-calibrated VREFINT */
uint32_t adc_read_vdda_mv(void);
/* Pin voltage in mV on an ADC1 channel (LL_ADC_CHANNEL_x), averaged */
uint32_t adc_read_channel_mv(uint32_t channel, uint32_t vdda_mv);

#endif
