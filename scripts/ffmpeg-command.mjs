import ffmpegStaticPath from 'ffmpeg-static';

export const ffmpegCommand =
  process.env.AELION_FFMPEG_PATH ??
  (typeof ffmpegStaticPath === 'string' && ffmpegStaticPath.length > 0
    ? ffmpegStaticPath
    : 'ffmpeg');
