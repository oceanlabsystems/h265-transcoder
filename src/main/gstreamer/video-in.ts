import { StreamConfig } from '@types/types';


export function getVideoInput(config: StreamConfig): string[] {
  return [
    'decklinkvideosrc', `device-number=${config.deviceNumber}`, 'mode=auto',
    '!'
  ];
}
