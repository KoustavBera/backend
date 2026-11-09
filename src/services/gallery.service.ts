import { prisma } from "../db/prisma.js";
import { AppError } from "../lib/errors.js";
import { recordAuditLog } from "./audit.service.js";
import { StorageService } from "./storage.service.js";
import type { AllowedMimeType } from "../lib/magic.js";
import type {
  GalleryPhotoDTO,
  GalleryCategoryDTO,
  CreateGalleryPhotoInput,
  UpdateGalleryPhotoInput,
} from "../dtos/gallery.dto.js";
import { GalleryCategory, type GalleryPhoto } from "@prisma/client";

const ALLOWED_GALLERY_IMAGE_TYPES: readonly AllowedMimeType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];
const MAX_GALLERY_PHOTO_SIZE = 10 * 1024 * 1024; // 10 MB
const DEFAULT_GALLERY_IMAGE = "/photos/outside_2.jpg";

const VALID_CATEGORIES: GalleryCategoryDTO[] = [
  "campus",
  "events",
  "sports",
  "academics",
  "celebrations",
];

export class GalleryService {
  /**
   * Resolves a photoKey to a publicly accessible or signed download URL.
   */
  static async resolvePhotoUrl(photoKey?: string | null): Promise<string> {
    if (!photoKey || !photoKey.trim()) {
      return DEFAULT_GALLERY_IMAGE;
    }
    const trimmed = photoKey.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/")) {
      return trimmed;
    }
    return StorageService.getDownloadUrl(trimmed);
  }

  /**
   * Converts a database GalleryPhoto record to a GalleryPhotoDTO.
   */
  static async toDTO(photo: GalleryPhoto): Promise<GalleryPhotoDTO> {
    const url = await this.resolvePhotoUrl(photo.photoKey);
    return {
      id: photo.id,
      title: photo.title,
      titleBn: photo.titleBn,
      category: photo.category as GalleryCategoryDTO,
      description: photo.description,
      url,
      photoKey: photo.photoKey,
      sortOrder: photo.sortOrder,
      isActive: photo.isActive,
      createdAt: photo.createdAt.toISOString(),
      updatedAt: photo.updatedAt.toISOString(),
    };
  }

  /**
   * Public: List active photos, optionally filtered by category.
   */
  static async listActive(category?: string): Promise<GalleryPhotoDTO[]> {
    const where: { isActive: boolean; category?: GalleryCategory } = {
      isActive: true,
    };
    if (category && category.trim() && category !== "all" && VALID_CATEGORIES.includes(category.trim() as GalleryCategoryDTO)) {
      where.category = category.trim() as GalleryCategory;
    }

    const photos = await prisma.galleryPhoto.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    return Promise.all(photos.map((p) => this.toDTO(p)));
  }

  /**
   * Admin: List all photos, optionally filtered by category.
   */
  static async listAll(category?: string): Promise<GalleryPhotoDTO[]> {
    const where: { category?: GalleryCategory } = {};
    if (category && category.trim() && category !== "all" && VALID_CATEGORIES.includes(category.trim() as GalleryCategoryDTO)) {
      where.category = category.trim() as GalleryCategory;
    }

    const photos = await prisma.galleryPhoto.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    return Promise.all(photos.map((p) => this.toDTO(p)));
  }

  /**
   * Public/Admin: Get a single photo by ID.
   */
  static async getById(id: string): Promise<GalleryPhotoDTO> {
    const photo = await prisma.galleryPhoto.findUnique({
      where: { id },
    });

    if (!photo) {
      throw AppError.notFound("Gallery photo not found");
    }

    return this.toDTO(photo);
  }

  /**
   * Admin: Generate a presigned R2 upload URL for a gallery photo.
   */
  static async createUploadUrl(params: {
    filename: string;
    contentType: string;
    sizeBytes: number;
    userId: string;
  }): Promise<{ uploadUrl: string; uploadIntentId: string; objectKey: string }> {
    const { filename, contentType, sizeBytes, userId } = params;

    if (!ALLOWED_GALLERY_IMAGE_TYPES.includes(contentType as AllowedMimeType)) {
      throw AppError.badRequest(
        `Invalid image type: ${contentType}. Allowed types: ${ALLOWED_GALLERY_IMAGE_TYPES.join(", ")}`
      );
    }

    if (sizeBytes <= 0 || sizeBytes > MAX_GALLERY_PHOTO_SIZE) {
      throw AppError.badRequest(
        `Image size must be between 1 byte and 10 MB. Received: ${sizeBytes} bytes`
      );
    }

    const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
    const objectKey = `gallery/${crypto.randomUUID()}.${ext}`;

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const intent = await prisma.uploadIntent.create({
      data: {
        userId,
        objectKey,
        contentType,
        sizeBytes: BigInt(sizeBytes),
        expiresAt,
      },
    });

    const uploadUrl = await StorageService.getUploadUrl({
      objectKey,
      contentType,
      contentLength: sizeBytes,
    });

    return {
      uploadUrl,
      uploadIntentId: intent.id,
      objectKey,
    };
  }

  /**
   * Admin: Create a new gallery photo record.
   */
  static async create(
    input: CreateGalleryPhotoInput,
    adminUserId: string,
    ip?: string
  ): Promise<GalleryPhotoDTO> {
    const title = input.title?.trim();
    if (!title) {
      throw AppError.badRequest("Photo title is required");
    }

    let photoKey = input.photoKey?.trim() || null;

    if (input.uploadIntentId) {
      const intent = await prisma.uploadIntent.findUnique({
        where: { id: input.uploadIntentId },
      });

      if (!intent) {
        throw AppError.notFound("Upload intent not found");
      }

      if (intent.finalizedAt) {
        throw AppError.badRequest("Upload intent has already been used");
      }

      if (intent.expiresAt < new Date()) {
        throw AppError.badRequest("Upload intent has expired. Please upload the photo again.");
      }

      // Verify file via magic bytes
      await StorageService.verifyUploadedFile({
        objectKey: intent.objectKey,
        expectedContentType: intent.contentType as AllowedMimeType,
        expectedMaxBytes: Number(intent.sizeBytes),
      });

      // Mark intent finalized
      await prisma.uploadIntent.update({
        where: { id: intent.id },
        data: { finalizedAt: new Date() },
      });

      photoKey = intent.objectKey;
    }

    if (!photoKey) {
      throw AppError.badRequest("A photo URL, R2 key, or upload intent is required");
    }

    let category: GalleryCategory = GalleryCategory.campus;
    if (input.category && VALID_CATEGORIES.includes(input.category)) {
      category = input.category as GalleryCategory;
    }

    const photo = await prisma.galleryPhoto.create({
      data: {
        title,
        titleBn: input.titleBn?.trim() || null,
        category,
        description: input.description?.trim() || null,
        photoKey,
        sortOrder: typeof input.sortOrder === "number" ? input.sortOrder : 0,
        isActive: input.isActive ?? true,
        createdById: adminUserId,
      },
    });

    await recordAuditLog({
      userId: adminUserId,
      action: "gallery.created",
      entityType: "GalleryPhoto",
      entityId: photo.id,
      metadata: { title: photo.title, category: photo.category },
      ip,
    });

    return this.toDTO(photo);
  }

  /**
   * Admin: Update an existing gallery photo.
   */
  static async update(
    id: string,
    input: UpdateGalleryPhotoInput,
    adminUserId: string,
    ip?: string
  ): Promise<GalleryPhotoDTO> {
    const existing = await prisma.galleryPhoto.findUnique({
      where: { id },
    });

    if (!existing) {
      throw AppError.notFound("Gallery photo not found");
    }

    let photoKey = existing.photoKey;

    if (input.uploadIntentId) {
      const intent = await prisma.uploadIntent.findUnique({
        where: { id: input.uploadIntentId },
      });

      if (!intent) {
        throw AppError.notFound("Upload intent not found");
      }

      if (intent.finalizedAt) {
        throw AppError.badRequest("Upload intent has already been used");
      }

      if (intent.expiresAt < new Date()) {
        throw AppError.badRequest("Upload intent has expired");
      }

      await StorageService.verifyUploadedFile({
        objectKey: intent.objectKey,
        expectedContentType: intent.contentType as AllowedMimeType,
        expectedMaxBytes: Number(intent.sizeBytes),
      });

      await prisma.uploadIntent.update({
        where: { id: intent.id },
        data: { finalizedAt: new Date() },
      });

      // If replacing an existing R2 photo, enqueue old photo for cleanup
      if (existing.photoKey && !existing.photoKey.startsWith("http") && !existing.photoKey.startsWith("/")) {
        await prisma.pendingDeletion.create({
          data: { objectKey: existing.photoKey },
        });
      }

      photoKey = intent.objectKey;
    } else if (input.photoKey) {
      const trimmed = input.photoKey.trim();
      if (
        existing.photoKey &&
        existing.photoKey !== trimmed &&
        !existing.photoKey.startsWith("http") &&
        !existing.photoKey.startsWith("/")
      ) {
        await prisma.pendingDeletion.create({
          data: { objectKey: existing.photoKey },
        });
      }
      photoKey = trimmed;
    }

    let category: GalleryCategory | undefined = undefined;
    if (input.category !== undefined) {
      if (VALID_CATEGORIES.includes(input.category)) {
        category = input.category as GalleryCategory;
      }
    }

    const updated = await prisma.galleryPhoto.update({
      where: { id },
      data: {
        title: input.title !== undefined ? input.title.trim() : undefined,
        titleBn: input.titleBn !== undefined ? input.titleBn?.trim() || null : undefined,
        category,
        description: input.description !== undefined ? input.description?.trim() || null : undefined,
        photoKey,
        sortOrder: typeof input.sortOrder === "number" ? input.sortOrder : undefined,
        isActive: input.isActive !== undefined ? input.isActive : undefined,
      },
    });

    await recordAuditLog({
      userId: adminUserId,
      action: "gallery.updated",
      entityType: "GalleryPhoto",
      entityId: updated.id,
      metadata: { title: updated.title, category: updated.category },
      ip,
    });

    return this.toDTO(updated);
  }

  /**
   * Admin: Delete a gallery photo.
   */
  static async delete(id: string, adminUserId: string, ip?: string): Promise<{ success: boolean }> {
    const existing = await prisma.galleryPhoto.findUnique({
      where: { id },
    });

    if (!existing) {
      throw AppError.notFound("Gallery photo not found");
    }

    const ops = [];
    if (existing.photoKey && !existing.photoKey.startsWith("http") && !existing.photoKey.startsWith("/")) {
      ops.push(
        prisma.pendingDeletion.create({
          data: { objectKey: existing.photoKey },
        })
      );
    }
    ops.push(
      prisma.galleryPhoto.delete({
        where: { id },
      })
    );

    await prisma.$transaction(ops);

    await recordAuditLog({
      userId: adminUserId,
      action: "gallery.deleted",
      entityType: "GalleryPhoto",
      entityId: id,
      metadata: { title: existing.title },
      ip,
    });

    return { success: true };
  }
}
