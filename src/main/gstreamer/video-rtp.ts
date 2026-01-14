import { StreamConfig } from "@types/types";

export function getRtpOutput(config: StreamConfig): string[] {
  return [
    "rtph265pay",
    "config-interval=1",
    "pt=96",
    "!",
    "udpsink",
    `host=${config.targetHost}`,
    `port=${config.port}`,
  ];
}
