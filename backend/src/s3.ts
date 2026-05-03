import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "./utils/logger.js";

export interface S3Config {
  bucket: string;
  region: string;
  endpoint?: string;
  publicUrl?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
}

let s3Client: S3Client | null = null;
let s3Config: S3Config | null = null;

export const initS3 = (cfg: S3Config): void => {
  s3Config = cfg;

  const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
    region: cfg.region,
  };

  if (cfg.endpoint) {
    clientConfig.endpoint = cfg.endpoint;
    clientConfig.forcePathStyle = cfg.forcePathStyle ?? false;
  }

  if (cfg.accessKeyId && cfg.secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    };
  }

  s3Client = new S3Client(clientConfig);
};

export const isS3Enabled = (): boolean =>
  s3Client !== null && s3Config !== null;

export const getS3Config = (): S3Config | null => s3Config;

export const generatePresignedUploadUrl = async (
  key: string,
  mimeType: string,
  expiresInSeconds = 300
): Promise<string> => {
  if (!s3Client || !s3Config) {
    throw new Error("S3 is not configured");
  }

  const command = new PutObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
    ContentType: mimeType,
    CacheControl: "public, max-age=31536000, immutable",
  });

  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
};

export const generatePresignedDownloadUrl = async (
  key: string,
  expiresInSeconds = 3600
): Promise<string> => {
  if (!s3Client || !s3Config) {
    throw new Error("S3 is not configured");
  }

  const command = new GetObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
    ResponseCacheControl: "public, max-age=31536000, immutable",
  });

  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
};

export const getPublicUrl = (key: string): string => {
  if (!s3Config) {
    throw new Error("S3 is not configured");
  }

  if (s3Config.publicUrl) {
    const base = s3Config.publicUrl.endsWith("/")
      ? s3Config.publicUrl.slice(0, -1)
      : s3Config.publicUrl;
    return `${base}/${key}`;
  }

  if (s3Config.endpoint) {
    logger.warn(
      "[S3] S3_PUBLIC_URL is not set but a custom S3_ENDPOINT is configured. " +
        "Public image URLs may not resolve correctly. Set S3_PUBLIC_URL to the " +
        "public base URL of your bucket or CDN."
    );
  }

  return `https://${s3Config.bucket}.s3.${s3Config.region}.amazonaws.com/${key}`;
};

export const uploadBuffer = async (
  key: string,
  body: Buffer,
  mimeType: string
): Promise<void> => {
  if (!s3Client || !s3Config) {
    throw new Error("S3 is not configured");
  }

  const command = new PutObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
    Body: body,
    ContentType: mimeType,
    CacheControl: "public, max-age=31536000, immutable",
  });

  await s3Client.send(command);
};

export const downloadObject = async (
  key: string
): Promise<{ body: import("stream").Readable; contentType: string | undefined }> => {
  if (!s3Client || !s3Config) {
    throw new Error("S3 is not configured");
  }

  const command = new GetObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
  });

  const response = await s3Client.send(command);
  return {
    body: response.Body as import("stream").Readable,
    contentType: response.ContentType,
  };
};

export const listS3Objects = async (
  prefix: string
): Promise<Array<{ key: string; size: number }>> => {
  if (!s3Client || !s3Config) {
    throw new Error("S3 is not configured");
  }

  const results: Array<{ key: string; size: number }> = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: s3Config.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });

    const response = await s3Client.send(command);

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key) {
          results.push({ key: obj.Key, size: obj.Size ?? 0 });
        }
      }
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return results;
};

export const deleteS3Object = async (key: string): Promise<void> => {
  if (!s3Client || !s3Config) {
    throw new Error("S3 is not configured");
  }

  const command = new DeleteObjectCommand({
    Bucket: s3Config.bucket,
    Key: key,
  });

  await s3Client.send(command);
};
