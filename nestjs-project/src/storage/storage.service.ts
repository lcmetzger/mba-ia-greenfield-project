import { Inject, Injectable } from '@nestjs/common';
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3_CLIENT } from './storage.constants';

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

const PRESIGNED_URL_EXPIRATION_SECONDS = 3600;

@Injectable()
export class StorageService {
  constructor(@Inject(S3_CLIENT) private readonly s3: S3Client) {}

  async createMultipartUpload(
    bucket: string,
    key: string,
    contentType: string,
  ): Promise<string> {
    const result = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!result.UploadId) {
      throw new Error('Object storage did not return an UploadId');
    }
    return result.UploadId;
  }

  async presignUploadPart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    return getSignedUrl(this.s3, command, {
      expiresIn: PRESIGNED_URL_EXPIRATION_SECONDS,
    });
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
          })),
        },
      }),
    );
  }

  async headObject(
    bucket: string,
    key: string,
  ): Promise<HeadObjectCommandOutput> {
    return this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  }

  async getObjectStream(
    bucket: string,
    key: string,
    range?: string,
  ): Promise<GetObjectCommandOutput> {
    return this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }),
    );
  }

  /**
   * Direct PUT for small objects (e.g. worker-generated thumbnails) — not part
   * of the multipart flow used for the original video upload.
   */
  async putObject(
    bucket: string,
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }
}
