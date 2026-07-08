export function buildVideoKey(videoId: string): string {
  return `videos/${videoId}/original`;
}

export function buildThumbnailKey(videoId: string): string {
  return `thumbnails/${videoId}/thumbnail.jpg`;
}
