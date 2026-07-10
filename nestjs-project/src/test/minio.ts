import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

const minioClient = new S3Client({
  region: process.env.STORAGE_REGION ?? 'us-east-1',
  endpoint: process.env.STORAGE_ENDPOINT ?? 'http://minio:9000',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY ?? 'streamtube',
    secretAccessKey: process.env.STORAGE_SECRET_KEY ?? 'streamtube123',
  },
});

export async function clearBucket(bucket: string): Promise<void> {
  const listed = await minioClient.send(
    new ListObjectsV2Command({ Bucket: bucket }),
  );
  const objects = listed.Contents ?? [];
  await Promise.all(
    objects
      .filter((obj) => obj.Key)
      .map((obj) =>
        minioClient.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }),
        ),
      ),
  );
}

export async function objectExists(
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await minioClient.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}
