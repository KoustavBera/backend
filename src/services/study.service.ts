import { prisma } from "../db/prisma";
import { AppError } from "../lib/errors";
import { slugify } from "../lib/slug";
import { recordAuditLog } from "./audit.service";
import { StorageService } from "./storage.service";
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  type AllowedMimeType,
} from "../lib/magic";
import {
  TONE_LIST,
  type SubjectDTO,
  type SubjectSummaryDTO,
  type StudyResourceDTO,
} from "../dtos/study.dto";
import type { AuthUser } from "../types/context";
import { UserRoleType, ResourceCategory, ResourceFormat } from "@prisma/client";

function extractYoutubeId(url: string): string | null {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/
  );
  return match ? match[1] : null;
}

export class StudyService {
  // ── 1. List Subjects for Class ──────────────────────────────────────────────
  static async listSubjects(classId: string): Promise<SubjectSummaryDTO[]> {
    const cls = await prisma.class.findUnique({
      where: { id: classId },
    });

    if (!cls) {
      throw AppError.notFound(`Class not found: ${classId}`);
    }

    const rawSubjects = await prisma.$queryRaw<
      Array<{
        id: string;
        class_id: string;
        slug: string;
        name: string;
        name_bn: string | null;
        icon: string;
        resource_count: number;
      }>
    >`
      SELECT s.id, s.class_id, s.slug, s.name, s.name_bn, s.icon,
             COUNT(r.id) FILTER (WHERE r.is_published = TRUE)::int AS resource_count
      FROM subjects s
      LEFT JOIN resources r ON r.subject_id = s.id
      WHERE s.class_id = ${classId} AND s.is_active = TRUE
      GROUP BY s.id, s.class_id, s.slug, s.name, s.name_bn, s.icon, s.created_at
      ORDER BY s.created_at ASC
    `;

    return rawSubjects.map((s, index) => ({
      id: s.slug,
      classId: s.class_id,
      name: s.name,
      bn: s.name_bn || undefined,
      icon: s.icon,
      tone: TONE_LIST[index % TONE_LIST.length],
      resourceCount: s.resource_count,
    }));
  }

  // ── 2. Get Single Subject Detail ────────────────────────────────────────────
  static async getSubject(classId: string, subjectSlug: string): Promise<SubjectDTO> {
    const allSubjects = await prisma.subject.findMany({
      where: { classId, isActive: true },
      orderBy: { createdAt: "asc" },
    });

    const index = allSubjects.findIndex((s) => s.slug === subjectSlug);
    if (index === -1) {
      throw AppError.notFound(`Subject not found: ${subjectSlug} in ${classId}`);
    }

    const subject = allSubjects[index];

    return {
      id: subject.slug,
      classId: subject.classId,
      name: subject.name,
      bn: subject.nameBn || undefined,
      icon: subject.icon,
      tone: TONE_LIST[index % TONE_LIST.length],
    };
  }

  // ── 3. Create Subject ───────────────────────────────────────────────────────
  static async createSubject(
    input: { classId: string; name: string; bn?: string; icon: string },
    user: AuthUser
  ): Promise<SubjectDTO> {
    const { classId, name, bn, icon } = input;
    const trimmedName = name.trim();

    if (!trimmedName) {
      throw AppError.badRequest("Please enter a subject name.");
    }

    if (!user.roles.includes(UserRoleType.admin) && !user.classes.includes(classId)) {
      throw AppError.forbidden(`You are not assigned to manage subjects for ${classId}`);
    }

    const cls = await prisma.class.findUnique({
      where: { id: classId },
    });
    if (!cls) {
      throw AppError.notFound(`Class not found: ${classId}`);
    }

    const existing = await prisma.subject.findFirst({
      where: { classId, name: trimmedName },
    });
    if (existing) {
      throw AppError.conflict(`${cls.label} already has a subject called "${trimmedName}".`);
    }

    let slug = slugify(trimmedName) || `subject-${Math.random().toString(36).slice(2, 7)}`;
    const slugCollision = await prisma.subject.findUnique({
      where: { classId_slug: { classId, slug } },
    });
    if (slugCollision) {
      slug = `${slug}-2`;
    }

    const subject = await prisma.subject.create({
      data: {
        classId,
        slug,
        name: trimmedName,
        nameBn: bn?.trim() || null,
        icon: icon || "book",
        createdBy: user.id,
      },
    });

    await recordAuditLog({
      userId: user.id,
      action: "study.subject_created",
      entityType: "Subject",
      entityId: subject.id,
      metadata: { classId, slug, name: trimmedName },
    });

    const allInClass = await prisma.subject.count({
      where: { classId, isActive: true },
    });

    return {
      id: subject.slug,
      classId: subject.classId,
      name: subject.name,
      bn: subject.nameBn || undefined,
      icon: subject.icon,
      tone: TONE_LIST[(allInClass - 1) % TONE_LIST.length],
    };
  }

  // ── 4. Delete Subject ───────────────────────────────────────────────────────
  static async deleteSubject(
    classId: string,
    subjectSlug: string,
    user: AuthUser
  ): Promise<void> {
    if (!user.roles.includes(UserRoleType.admin) && !user.classes.includes(classId)) {
      throw AppError.forbidden(`You are not assigned to manage subjects for ${classId}`);
    }

    const subject = await prisma.subject.findUnique({
      where: { classId_slug: { classId, slug: subjectSlug } },
      include: {
        resources: {
          select: { objectKey: true },
        },
      },
    });

    if (!subject) {
      throw AppError.notFound(`Subject not found: ${subjectSlug} in ${classId}`);
    }

    const fileKeys = subject.resources
      .map((r) => r.objectKey)
      .filter((k): k is string => typeof k === "string" && !k.startsWith("/"));

    await prisma.$transaction(async (tx) => {
      if (fileKeys.length > 0) {
        await tx.pendingDeletion.createMany({
          data: fileKeys.map((key) => ({ objectKey: key })),
        });
      }

      await tx.subject.delete({
        where: { id: subject.id },
      });
    });

    await recordAuditLog({
      userId: user.id,
      action: "study.subject_deleted",
      entityType: "Subject",
      entityId: subject.id,
      metadata: { classId, slug: subjectSlug, queuedDeletions: fileKeys.length },
    });
  }

  // ── 5. Generate Presigned Upload URL (Upload Intent) ─────────────────────────
  static async generateUploadUrl(
    params: {
      classId?: string;
      subjectId: string; // subject slug or UUID
      filename: string;
      contentType: string;
      bytes: number;
    },
    user: AuthUser
  ): Promise<{ uploadUrl: string; objectKey: string; intentId: string; expiresAt: string }> {
    const { classId, subjectId, filename, contentType, bytes } = params;

    // Find subject by UUID or slug safely without invalid UUID cast error
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      subjectId
    );

    const subject = await prisma.subject.findFirst({
      where: isUuid
        ? { id: subjectId, isActive: true }
        : {
            slug: subjectId,
            ...(classId
              ? { classId }
              : user.roles.includes(UserRoleType.admin)
              ? {}
              : { classId: { in: user.classes } }),
            isActive: true,
          },
    });

    if (!subject) {
      throw AppError.notFound(`Subject not found: ${subjectId}`);
    }

    if (!user.roles.includes(UserRoleType.admin) && !user.classes.includes(subject.classId)) {
      throw AppError.forbidden(`You are not assigned to manage resources for ${subject.classId}`);
    }

    if (!ALLOWED_MIME_TYPES.includes(contentType as AllowedMimeType)) {
      throw AppError.badRequest(
        `Invalid content type: ${contentType}. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}`
      );
    }

    if (bytes <= 0 || bytes > MAX_UPLOAD_BYTES) {
      throw AppError.badRequest(
        `File size must be between 1 byte and ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`
      );
    }

    const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
    const objectKey = `uploads/resources/${subject.classId}/${subject.slug}/${crypto.randomUUID()}-${safeName}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1-hour upload window

    const uploadUrl = await StorageService.getUploadUrl({
      objectKey,
      contentType,
      contentLength: bytes,
    });

    const intent = await prisma.uploadIntent.create({
      data: {
        userId: user.id,
        subjectId: subject.id,
        objectKey,
        contentType,
        sizeBytes: BigInt(bytes),
        expiresAt,
      },
    });

    return {
      uploadUrl,
      objectKey,
      intentId: intent.id,
      expiresAt: intent.expiresAt.toISOString(),
    };
  }

  // ── 6. Create Resource (Finalize Upload or YouTube link) ──────────────────────
  static async createResource(
    params: {
      classId: string;
      subjectSlug: string;
      category: ResourceCategory;
      format: ResourceFormat;
      title: string;
      chapter?: string;
      intentId?: string;
      youtubeUrl?: string;
      academicYear: string;
    },
    user: AuthUser
  ): Promise<StudyResourceDTO> {
    const {
      classId,
      subjectSlug,
      category,
      format,
      title,
      chapter,
      intentId,
      youtubeUrl,
      academicYear,
    } = params;

    if (!user.roles.includes(UserRoleType.admin) && !user.classes.includes(classId)) {
      throw AppError.forbidden(`You are not assigned to manage content for ${classId}`);
    }

    const subject = await prisma.subject.findUnique({
      where: { classId_slug: { classId, slug: subjectSlug } },
    });
    if (!subject) {
      throw AppError.notFound(`Subject not found: ${subjectSlug} in ${classId}`);
    }

    // Validate academic year format: e.g. '2025-26'
    if (!/^[0-9]{4}-[0-9]{2}$/.test(academicYear)) {
      throw AppError.badRequest("Invalid academic year format. Expected YYYY-YY (e.g. 2025-26)");
    }

    let finalObjectKey: string | null = null;
    let finalYoutubeUrl: string | null = null;

    if (format === ResourceFormat.youtube) {
      if (!youtubeUrl) {
        throw AppError.badRequest("YouTube URL is required for video format");
      }
      const videoId = extractYoutubeId(youtubeUrl);
      if (!videoId) {
        throw AppError.badRequest("Invalid YouTube URL. Must contain a valid video ID.");
      }
      finalYoutubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    } else {
      // File upload (PDF or Image) requires verified intent
      if (!intentId) {
        throw AppError.badRequest("intentId is required for file uploads");
      }

      const intent = await prisma.uploadIntent.findUnique({
        where: { id: intentId },
      });

      if (!intent || intent.subjectId !== subject.id) {
        throw AppError.badRequest("Invalid upload intent for this subject");
      }

      if (intent.finalizedAt !== null) {
        throw AppError.badRequest("Upload intent has already been used");
      }

      if (intent.expiresAt < new Date()) {
        throw AppError.badRequest("Upload intent has expired");
      }

      // Two-tier upload verification (Metadata + Magic Bytes)
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

      finalObjectKey = intent.objectKey;
    }

    const resource = await prisma.resource.create({
      data: {
        subjectId: subject.id,
        category,
        format,
        title: title.trim(),
        chapter: chapter?.trim() || null,
        objectKey: finalObjectKey,
        youtubeUrl: finalYoutubeUrl,
        uploadedBy: user.id,
        academicYear,
        isPublished: false, // Draft by default as designed
      },
      include: {
        uploader: { select: { displayName: true } },
      },
    });

    await recordAuditLog({
      userId: user.id,
      action: "study.resource_created",
      entityType: "Resource",
      entityId: resource.id,
      metadata: { classId, subjectSlug, title, format, isDraft: true },
    });

    const downloadUrl = finalYoutubeUrl
      ? finalYoutubeUrl
      : finalObjectKey
      ? await StorageService.getDownloadUrl(finalObjectKey)
      : "";

    return {
      id: resource.id,
      classId,
      subjectId: subjectSlug,
      category: resource.category as "video" | "notes" | "book" | "pyq",
      format: resource.format as "youtube" | "pdf" | "image",
      title: resource.title,
      chapter: resource.chapter || undefined,
      url: downloadUrl,
      uploadedAt: resource.uploadedAt.toISOString().slice(0, 10),
      uploadedBy: resource.uploader?.displayName || user.displayName,
    };
  }

  // ── 7. Publish Resource (Draft -> Published) ─────────────────────────────────
  static async publishResource(resourceId: string, user: AuthUser): Promise<void> {
    const resource = await prisma.resource.findUnique({
      where: { id: resourceId },
      include: { subject: true },
    });

    if (!resource) {
      throw AppError.notFound(`Resource not found: ${resourceId}`);
    }

    const isSiteAdmin = user.roles.includes(UserRoleType.admin);
    const isUploader = resource.uploadedBy === user.id;

    if (!isSiteAdmin && !isUploader) {
      throw AppError.forbidden("Only the uploader or an admin can publish this draft");
    }

    if (!isSiteAdmin && !user.classes.includes(resource.subject.classId)) {
      throw AppError.forbidden(
        `You do not have access to manage resources for ${resource.subject.classId}`
      );
    }

    await prisma.resource.update({
      where: { id: resourceId },
      data: { isPublished: true },
    });

    await recordAuditLog({
      userId: user.id,
      action: "study.resource_published",
      entityType: "Resource",
      entityId: resourceId,
      metadata: { title: resource.title },
    });
  }

  // ── 8. Delete Resource (Transactional queue cleanup) ─────────────────────────
  static async deleteResource(resourceId: string, user: AuthUser): Promise<void> {
    const resource = await prisma.resource.findUnique({
      where: { id: resourceId },
      include: { subject: true },
    });

    if (!resource) {
      throw AppError.notFound(`Resource not found: ${resourceId}`);
    }

    const isSiteAdmin = user.roles.includes(UserRoleType.admin);
    const isUploader = resource.uploadedBy === user.id;

    if (!isSiteAdmin && !isUploader) {
      throw AppError.forbidden("Only the uploader or an admin can delete this resource");
    }

    if (!isSiteAdmin && !user.classes.includes(resource.subject.classId)) {
      throw AppError.forbidden(
        `You do not have access to manage resources for ${resource.subject.classId}`
      );
    }

    await prisma.$transaction(async (tx) => {
      // If resource had a permanent R2 object key, enqueue for transactional deletion
      if (resource.objectKey && !resource.objectKey.startsWith("/")) {
        await tx.pendingDeletion.create({
          data: { objectKey: resource.objectKey },
        });
      }

      await tx.resource.delete({
        where: { id: resourceId },
      });
    });

    await recordAuditLog({
      userId: user.id,
      action: "study.resource_deleted",
      entityType: "Resource",
      entityId: resourceId,
      metadata: { title: resource.title, objectKey: resource.objectKey },
    });
  }

  // ── 9. List Published Resources (Fresh Signed Download URLs) ──────────────────
  static async listResources(
    classId: string,
    subjectSlug: string,
    academicYear?: string
  ): Promise<StudyResourceDTO[]> {
    const subject = await prisma.subject.findUnique({
      where: { classId_slug: { classId, slug: subjectSlug } },
    });

    if (!subject) {
      throw AppError.notFound(`Subject not found: ${subjectSlug} in ${classId}`);
    }

    const resources = await prisma.resource.findMany({
      where: {
        subjectId: subject.id,
        isPublished: true,
        ...(academicYear ? { academicYear } : {}),
      },
      include: {
        uploader: { select: { displayName: true } },
      },
      orderBy: { uploadedAt: "desc" },
    });

    return Promise.all(
      resources.map(async (r) => {
        let url = "";
        if (r.format === "youtube") {
          url = r.youtubeUrl || "";
        } else if (r.objectKey) {
          url = await StorageService.getDownloadUrl(r.objectKey);
        }

        return {
          id: r.id,
          classId,
          subjectId: subjectSlug,
          category: r.category as "video" | "notes" | "book" | "pyq",
          format: r.format as "youtube" | "pdf" | "image",
          title: r.title,
          chapter: r.chapter || undefined,
          url,
          uploadedAt: r.uploadedAt.toISOString().slice(0, 10),
          uploadedBy: r.uploader?.displayName || "Subject teacher",
        };
      })
    );
  }

  // ── 10. List Drafts ──────────────────────────────────────────────────────────
  static async listDrafts(
    classId: string,
    subjectSlug: string,
    user: AuthUser
  ): Promise<StudyResourceDTO[]> {
    const subject = await prisma.subject.findUnique({
      where: { classId_slug: { classId, slug: subjectSlug } },
    });

    if (!subject) {
      throw AppError.notFound(`Subject not found: ${subjectSlug} in ${classId}`);
    }

    const isSiteAdmin = user.roles.includes(UserRoleType.admin);

    const drafts = await prisma.resource.findMany({
      where: {
        subjectId: subject.id,
        isPublished: false,
        ...(isSiteAdmin ? {} : { uploadedBy: user.id }),
      },
      include: {
        uploader: { select: { displayName: true } },
      },
      orderBy: { uploadedAt: "desc" },
    });

    return Promise.all(
      drafts.map(async (r) => {
        let url = "";
        if (r.format === "youtube") {
          url = r.youtubeUrl || "";
        } else if (r.objectKey) {
          url = await StorageService.getDownloadUrl(r.objectKey);
        }

        return {
          id: r.id,
          classId,
          subjectId: subjectSlug,
          category: r.category as "video" | "notes" | "book" | "pyq",
          format: r.format as "youtube" | "pdf" | "image",
          title: r.title,
          chapter: r.chapter || undefined,
          url,
          uploadedAt: r.uploadedAt.toISOString().slice(0, 10),
          uploadedBy: r.uploader?.displayName || user.displayName,
        };
      })
    );
  }
}
