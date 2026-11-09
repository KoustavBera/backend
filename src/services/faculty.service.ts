import { prisma } from "../db/prisma.js";
import { AppError } from "../lib/errors.js";
import { recordAuditLog } from "./audit.service.js";
import { StorageService } from "./storage.service.js";
import { slugify } from "../lib/slug.js";
import type { AllowedMimeType } from "../lib/magic.js";
import type {
  FacultyDTO,
  CreateFacultyInput,
  UpdateFacultyInput,
} from "../dtos/faculty.dto.js";
import type { FacultyMember } from "@prisma/client";

const ALLOWED_FACULTY_IMAGE_TYPES: readonly AllowedMimeType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];
const MAX_FACULTY_PHOTO_SIZE = 5 * 1024 * 1024; // 5 MB
const DEFAULT_AVATAR =
  "https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=300&q=80";

export class FacultyService {
  /**
   * Resolves a photoKey to a publicly accessible or signed download URL.
   */
  static async resolvePhotoUrl(photoKey?: string | null): Promise<string> {
    if (!photoKey || !photoKey.trim()) {
      return DEFAULT_AVATAR;
    }
    const trimmed = photoKey.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/")) {
      return trimmed;
    }
    return StorageService.getDownloadUrl(trimmed);
  }

  /**
   * Converts a database FacultyMember record to a FacultyDTO.
   */
  static async toDTO(member: FacultyMember): Promise<FacultyDTO> {
    const image = await this.resolvePhotoUrl(member.photoKey);
    return {
      id: member.id,
      slug: member.slug,
      name: member.name,
      nameBn: member.nameBn,
      designation: member.designation,
      designationBn: member.designationBn,
      department: member.department,
      education: member.education,
      educationBn: member.educationBn,
      description: member.description,
      image,
      photoKey: member.photoKey,
      sortOrder: member.sortOrder,
      isActive: member.isActive,
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
    };
  }

  /**
   * Public: List active faculty members, optionally filtered by department.
   */
  static async listActive(department?: string): Promise<FacultyDTO[]> {
    const where: { isActive: boolean; department?: string } = {
      isActive: true,
    };
    if (department && department.trim() && department !== "all") {
      where.department = department.trim();
    }

    const members = await prisma.facultyMember.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return Promise.all(members.map((m) => this.toDTO(m)));
  }

  /**
   * Admin: List all faculty members.
   */
  static async listAll(department?: string): Promise<FacultyDTO[]> {
    const where: { department?: string } = {};
    if (department && department.trim() && department !== "all") {
      where.department = department.trim();
    }

    const members = await prisma.facultyMember.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return Promise.all(members.map((m) => this.toDTO(m)));
  }

  /**
   * Public/Admin: Get a single faculty member by ID or slug.
   */
  static async getByIdOrSlug(idOrSlug: string): Promise<FacultyDTO> {
    const trimmed = idOrSlug.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);

    const member = await prisma.facultyMember.findFirst({
      where: isUuid ? { OR: [{ id: trimmed }, { slug: trimmed }] } : { slug: trimmed },
    });

    if (!member) {
      throw AppError.notFound("Faculty member not found");
    }

    return this.toDTO(member);
  }

  /**
   * Admin: Generate a presigned R2 upload URL for a faculty photo.
   */
  static async createUploadUrl(params: {
    filename: string;
    contentType: string;
    sizeBytes: number;
    userId: string;
  }): Promise<{ uploadUrl: string; uploadIntentId: string; objectKey: string }> {
    const { filename, contentType, sizeBytes, userId } = params;

    if (!ALLOWED_FACULTY_IMAGE_TYPES.includes(contentType as AllowedMimeType)) {
      throw AppError.badRequest(
        `Invalid image type: ${contentType}. Allowed types: ${ALLOWED_FACULTY_IMAGE_TYPES.join(", ")}`
      );
    }

    if (sizeBytes <= 0 || sizeBytes > MAX_FACULTY_PHOTO_SIZE) {
      throw AppError.badRequest(
        `Image size must be between 1 byte and 5 MB. Received: ${sizeBytes} bytes`
      );
    }

    const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
    const objectKey = `faculty/${crypto.randomUUID()}.${ext}`;

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
   * Helper to ensure unique slug
   */
  private static async generateUniqueSlug(baseText: string, currentId?: string): Promise<string> {
    let slug = slugify(baseText) || `faculty-${Math.random().toString(36).slice(2, 7)}`;
    let count = 1;
    let candidate = slug;

    while (true) {
      const existing = await prisma.facultyMember.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });

      if (!existing || (currentId && existing.id === currentId)) {
        return candidate;
      }

      count += 1;
      candidate = `${slug}-${count}`;
    }
  }

  /**
   * Admin: Create a new faculty member.
   */
  static async create(
    input: CreateFacultyInput,
    adminUserId: string,
    ip?: string
  ): Promise<FacultyDTO> {
    const name = input.name?.trim();
    if (!name) {
      throw AppError.badRequest("Faculty member name is required");
    }

    const designation = input.designation?.trim();
    if (!designation) {
      throw AppError.badRequest("Designation is required");
    }

    const education = input.education?.trim();
    if (!education) {
      throw AppError.badRequest("Educational qualifications are required");
    }

    const slug = await this.generateUniqueSlug(input.slug?.trim() || name);

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

    const member = await prisma.facultyMember.create({
      data: {
        slug,
        name,
        nameBn: input.nameBn?.trim() || null,
        designation,
        designationBn: input.designationBn?.trim() || null,
        department: input.department?.trim() || "General",
        education,
        educationBn: input.educationBn?.trim() || null,
        description: input.description?.trim() || null,
        photoKey,
        sortOrder: typeof input.sortOrder === "number" ? input.sortOrder : 0,
        isActive: input.isActive ?? true,
        createdById: adminUserId,
      },
    });

    await recordAuditLog({
      userId: adminUserId,
      action: "faculty.created",
      entityType: "FacultyMember",
      entityId: member.id,
      metadata: { name: member.name, designation: member.designation, slug: member.slug },
      ip,
    });

    return this.toDTO(member);
  }

  /**
   * Admin: Update an existing faculty member.
   */
  static async update(
    id: string,
    input: UpdateFacultyInput,
    adminUserId: string,
    ip?: string
  ): Promise<FacultyDTO> {
    const existing = await prisma.facultyMember.findUnique({
      where: { id },
    });

    if (!existing) {
      throw AppError.notFound("Faculty member not found");
    }

    let slug = existing.slug;
    if (input.slug?.trim()) {
      slug = await this.generateUniqueSlug(input.slug.trim(), id);
    } else if (input.name !== undefined && input.name.trim() && !input.slug) {
      // Don't auto-change slug on name edit unless requested
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
    } else if (input.photoKey !== undefined) {
      if (
        existing.photoKey &&
        existing.photoKey !== input.photoKey &&
        !existing.photoKey.startsWith("http") &&
        !existing.photoKey.startsWith("/")
      ) {
        await prisma.pendingDeletion.create({
          data: { objectKey: existing.photoKey },
        });
      }
      photoKey = input.photoKey?.trim() || null;
    }

    const updated = await prisma.facultyMember.update({
      where: { id },
      data: {
        slug,
        name: input.name !== undefined ? input.name.trim() : undefined,
        nameBn: input.nameBn !== undefined ? input.nameBn?.trim() || null : undefined,
        designation: input.designation !== undefined ? input.designation.trim() : undefined,
        designationBn: input.designationBn !== undefined ? input.designationBn?.trim() || null : undefined,
        department: input.department !== undefined ? input.department.trim() : undefined,
        education: input.education !== undefined ? input.education.trim() : undefined,
        educationBn: input.educationBn !== undefined ? input.educationBn?.trim() || null : undefined,
        description: input.description !== undefined ? input.description?.trim() || null : undefined,
        photoKey,
        sortOrder: typeof input.sortOrder === "number" ? input.sortOrder : undefined,
        isActive: input.isActive !== undefined ? input.isActive : undefined,
      },
    });

    await recordAuditLog({
      userId: adminUserId,
      action: "faculty.updated",
      entityType: "FacultyMember",
      entityId: updated.id,
      metadata: { name: updated.name, designation: updated.designation },
      ip,
    });

    return this.toDTO(updated);
  }

  /**
   * Admin: Delete a faculty member.
   */
  static async delete(id: string, adminUserId: string, ip?: string): Promise<{ success: boolean }> {
    const existing = await prisma.facultyMember.findUnique({
      where: { id },
    });

    if (!existing) {
      throw AppError.notFound("Faculty member not found");
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
      prisma.facultyMember.delete({
        where: { id },
      })
    );

    await prisma.$transaction(ops);

    await recordAuditLog({
      userId: adminUserId,
      action: "faculty.deleted",
      entityType: "FacultyMember",
      entityId: id,
      metadata: { name: existing.name, slug: existing.slug },
      ip,
    });

    return { success: true };
  }
}
