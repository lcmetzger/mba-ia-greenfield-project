import { execFile } from 'child_process';
import { promisify } from 'util';
import { Injectable } from '@nestjs/common';

const execFileAsync = promisify(execFile);

export interface VideoMetadata {
  durationSeconds: number;
  width: number;
  height: number;
  codec: string;
  bitrate: number;
}

interface FfprobeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
}

interface FfprobeOutput {
  streams: FfprobeStream[];
  format: {
    duration?: string;
    bit_rate?: string;
  };
}

@Injectable()
export class FfmpegService {
  async extractMetadata(path: string): Promise<VideoMetadata> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      path,
    ]);

    const parsed = JSON.parse(stdout) as FfprobeOutput;
    const videoStream = parsed.streams.find(
      (stream) => stream.codec_type === 'video',
    );
    if (!videoStream) {
      throw new Error(`No video stream found in ${path}`);
    }

    return {
      durationSeconds: Number(parsed.format.duration ?? 0),
      width: videoStream.width ?? 0,
      height: videoStream.height ?? 0,
      codec: videoStream.codec_name ?? 'unknown',
      bitrate: Number(parsed.format.bit_rate ?? 0),
    };
  }

  async generateThumbnail(
    path: string,
    outputPath: string,
    atSeconds: number,
  ): Promise<void> {
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss',
      String(atSeconds),
      '-i',
      path,
      '-vframes',
      '1',
      '-vf',
      'scale=320:-1',
      outputPath,
    ]);
  }
}
