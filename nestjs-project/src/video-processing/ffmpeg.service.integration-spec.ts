import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FfmpegService } from './ffmpeg.service';

const FIXTURE_PATH = join(
  __dirname,
  '..',
  'test',
  'fixtures',
  'sample-video.mp4',
);

describe('FfmpegService (integration)', () => {
  const ffmpegService = new FfmpegService();
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'ffmpeg-test-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  describe('extractMetadata', () => {
    it('extracts duration, dimensions, and codec from a real video file', async () => {
      const metadata = await ffmpegService.extractMetadata(FIXTURE_PATH);

      expect(metadata.durationSeconds).toBeCloseTo(2, 0);
      expect(metadata.width).toBe(320);
      expect(metadata.height).toBe(240);
      expect(metadata.codec).toBe('h264');
      expect(metadata.bitrate).toBeGreaterThan(0);
    });

    it('rejects for a non-existent file', async () => {
      await expect(
        ffmpegService.extractMetadata(join(workDir, 'does-not-exist.mp4')),
      ).rejects.toThrow();
    });

    it('rejects for a corrupted/non-video file', async () => {
      const corruptedPath = join(workDir, 'corrupted.mp4');
      writeFileSync(corruptedPath, 'this is not a video file');

      await expect(
        ffmpegService.extractMetadata(corruptedPath),
      ).rejects.toThrow();
    });
  });

  describe('generateThumbnail', () => {
    it('produces a non-empty jpg file from a real video frame', async () => {
      const outputPath = join(workDir, 'thumbnail.jpg');

      await ffmpegService.generateThumbnail(FIXTURE_PATH, outputPath, 1);

      expect(existsSync(outputPath)).toBe(true);
      expect(statSync(outputPath).size).toBeGreaterThan(0);
    });
  });
});
