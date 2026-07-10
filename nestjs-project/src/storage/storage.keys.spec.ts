import { buildThumbnailKey, buildVideoKey } from './storage.keys';

describe('storage.keys', () => {
  describe('buildVideoKey', () => {
    it('builds the original video key from the video id', () => {
      expect(buildVideoKey('abc-123')).toBe('videos/abc-123/original');
    });
  });

  describe('buildThumbnailKey', () => {
    it('builds the thumbnail key from the video id', () => {
      expect(buildThumbnailKey('abc-123')).toBe(
        'thumbnails/abc-123/thumbnail.jpg',
      );
    });
  });
});
