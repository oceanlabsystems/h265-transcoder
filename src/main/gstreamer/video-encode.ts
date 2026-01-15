import { StreamConfig } from '../types/types';


export function getEncoder(config: StreamConfig): string[] {
  return config.useNvenc
    ? ['nvh265enc', `bitrate=${config.bitrate}`, '!']
    : ['x265enc', `bitrate=${config.bitrate}`, 'tune=zerolatency', '!'];
}
