import { spawn } from 'child_process';
import { getVideoInput } from './video-in';
import { getVideoConvert } from './video-convert';
import { getEncoder } from './video-encode';
import { getRtpOutput } from './video-rtp';
import { StreamConfig } from '../types/types';
import { getGstLaunchPath, getGStreamerPath } from '../utils/gstreamer-path';


export function startStream(config: StreamConfig) {
  const args = [
    ...getVideoInput(config),
    ...getVideoConvert(),
    ...getEncoder(config),
    ...getRtpOutput(config)
  ];

  const gstLaunchPath = getGstLaunchPath();
  const { env: gstEnv } = getGStreamerPath();
  const processEnv = { ...process.env, ...gstEnv };

  const gst = spawn(gstLaunchPath, args, {
    env: processEnv,
  });

  gst.stdout.on('data', data => console.log(`[GStreamer] ${data}`));
  gst.stderr.on('data', data => console.error(`[GStreamer ERROR] ${data}`));
  gst.on('exit', code => console.log(`GStreamer exited with code ${code}`));

  return gst;
}
