export function getVideoConvert(): string[] {
  return [
    'videoconvert',
    '!', 'video/x-raw,format=NV12'
  ];
}
