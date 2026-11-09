import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config";
import { AppError } from "../lib/errors";
import { matchMagicBytes, type AllowedMimeType } from "../lib/magic";

let s3Client: S3Client | null = null;

export const isR2Configured = Boolean(
  config.R2_ACCOUNT_ID &&
  config.R2_ACCOUNT_ID !== "your-cloudflare-account-id" &&
  config.R2_ACCESS_KEY_ID &&
  config.R2_ACCESS_KEY_ID !== "your-r2-access-key-id" &&
  config.R2_SECRET_ACCESS_KEY &&
  config.R2_SECRET_ACCESS_KEY !== "your-r2-secret-access-key" &&
  config.R2_BUCKET
);

if (isR2Configured) {
  s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    },
  });
}

export class StorageService {
  // ── 1. Issue Presigned Upload URL (1 hour) ───────────────────────────────────
  static async getUploadUrl(params: {
    objectKey: string;
    contentType: string;
    contentLength: number;
  }): Promise<string> {
    const { objectKey, contentType, contentLength } = params;

    if (!isR2Configured || !s3Client) {
      // In local dev without R2 credentials: issue simulated dev upload endpoint
      return `http://localhost:${config.PORT}/api/study/dev-upload?key=${encodeURIComponent(
        objectKey
      )}`;
    }

    const command = new PutObjectCommand({
      Bucket: config.R2_BUCKET,
      Key: objectKey,
      ContentType: contentType,
      ContentLength: contentLength,
    });

    return getSignedUrl(s3Client, command, { expiresIn: 3600 });
  }

  // ── 2. Issue Fresh Signed Download URL (1 hour) ───────────────────────────────
  static async getDownloadUrl(objectKey: string): Promise<string> {
    // If it's a static public asset path (e.g. sample.pdf) or R2 is not configured
    if (objectKey.startsWith("/") || !isR2Configured || !s3Client) {
      return objectKey.startsWith("/") ? objectKey : `/${objectKey}`;
    }

    if (config.R2_PUBLIC_URL) {
      return `${config.R2_PUBLIC_URL}/${objectKey}`;
    }

    const command = new GetObjectCommand({
      Bucket: config.R2_BUCKET,
      Key: objectKey,
    });

    return getSignedUrl(s3Client, command, { expiresIn: 3600 });
  }

  // ── 3. Two-Tier Upload Verification (Metadata + Magic Bytes) ─────────────────
  static async verifyUploadedFile(params: {
    objectKey: string;
    expectedContentType: AllowedMimeType;
    expectedMaxBytes: number;
  }): Promise<{ verifiedSize: number }> {
    const { objectKey, expectedContentType, expectedMaxBytes } = params;

    if (!isR2Configured || !s3Client) {
      // Dev fallback when R2 credentials are not set
      return { verifiedSize: 1024 };
    }

    // Step 1: HeadObject checks existence and metadata
    let contentLength = 0;
    try {
      const head = await s3Client.send(
        new HeadObjectCommand({
          Bucket: config.R2_BUCKET,
          Key: objectKey,
        })
      );
      contentLength = head.ContentLength ?? 0;
    } catch {
      throw AppError.badRequest("Uploaded file could not be found in storage");
    }

    if (contentLength <= 0) {
      throw AppError.badRequest("Uploaded file is empty");
    }

    if (contentLength > expectedMaxBytes) {
      throw AppError.badRequest(
        `File size (${Math.round(contentLength / 1024 / 1024)}MB) exceeds limit of ${Math.round(
          expectedMaxBytes / 1024 / 1024
        )}MB`
      );
    }

    // Step 2: GetObject with byte-range Range: bytes=0-15 to inspect magic bytes
    try {
      const rangeResponse = await s3Client.send(
        new GetObjectCommand({
          Bucket: config.R2_BUCKET,
          Key: objectKey,
          Range: "bytes=0-15",
        })
      );

      const stream = rangeResponse.Body;
      if (!stream) {
        throw AppError.badRequest("Failed to inspect file signature");
      }

      const chunks: Uint8Array[] = [];
      for await (const chunk of stream as any) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      const isSignatureValid = matchMagicBytes(new Uint8Array(buffer), expectedContentType);

      if (!isSignatureValid) {
        throw AppError.badRequest(
          `File content signature does not match declared type: ${expectedContentType}`
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw AppError.badRequest("File signature verification failed");
    }

    return { verifiedSize: contentLength };
  }

  // ── 4. Delete Object ─────────────────────────────────────────────────────────
  static async deleteObject(objectKey: string): Promise<void> {
    if (!isR2Configured || !s3Client) return;

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: config.R2_BUCKET,
        Key: objectKey,
      })
    );
  }
}

