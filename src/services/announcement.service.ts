import { prisma } from "../db/prisma.js";
import { AppError } from "../lib/errors.js";
import { recordAuditLog } from "./audit.service.js";
import type {
  AnnouncementDTO,
  AnnouncementSeverityDTO,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
} from "../dtos/announcement.dto.js";

export class AnnouncementService {
  /**
   * Public: List all currently active announcements within valid date windows
   */
  static async listActive(lang: "en" | "bn" = "en"): Promise<AnnouncementDTO[]> {
    const now = new Date();

    const items = await prisma.announcement.findMany({
      where: {
        isActive: true,
        AND: [
          {
            OR: [{ startDate: null }, { startDate: { lte: now } }],
          },
          {
            OR: [{ endDate: null }, { endDate: { gte: now } }],
          },
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    return items.map((ann) => {
      const text = lang === "bn" && ann.textBn?.trim() ? ann.textBn : ann.textEn;
      return {
        id: ann.id,
        textEn: ann.textEn,
        textBn: ann.textBn,
        text,
        link: ann.link,
        severity: ann.severity as AnnouncementSeverityDTO,
        isActive: ann.isActive,
        sortOrder: ann.sortOrder,
        startDate: ann.startDate ? ann.startDate.toISOString() : null,
        endDate: ann.endDate ? ann.endDate.toISOString() : null,
        createdAt: ann.createdAt.toISOString(),
        updatedAt: ann.updatedAt.toISOString(),
      };
    });
  }

  /**
   * Admin: List all announcements (active, inactive, future, expired)
   */
  static async listAll() {
    const items = await prisma.announcement.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      include: {
        creator: {
          select: { id: true, email: true, displayName: true },
        },
      },
    });

    const now = new Date();
    const formatted = items.map((ann) => {
      const isExpired = ann.endDate ? ann.endDate < now : false;
      const isScheduled = ann.startDate ? ann.startDate > now : false;
      return {
        id: ann.id,
        textEn: ann.textEn,
        textBn: ann.textBn,
        link: ann.link,
        severity: ann.severity as AnnouncementSeverityDTO,
        isActive: ann.isActive,
        isCurrentlyLive: ann.isActive && !isExpired && !isScheduled,
        isExpired,
        isScheduled,
        sortOrder: ann.sortOrder,
        startDate: ann.startDate ? ann.startDate.toISOString() : null,
        endDate: ann.endDate ? ann.endDate.toISOString() : null,
        createdAt: ann.createdAt.toISOString(),
        updatedAt: ann.updatedAt.toISOString(),
        creator: ann.creator,
      };
    });

    return {
      total: items.length,
      activeCount: formatted.filter((a) => a.isCurrentlyLive).length,
      items: formatted,
    };
  }

  /**
   * Admin: Get a single announcement by ID
   */
  static async getById(id: string): Promise<AnnouncementDTO> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isUuid) {
      throw AppError.notFound(`Announcement not found: ${id}`);
    }

    const ann = await prisma.announcement.findUnique({
      where: { id },
    });

    if (!ann) {
      throw AppError.notFound(`Announcement not found: ${id}`);
    }

    return {
      id: ann.id,
      textEn: ann.textEn,
      textBn: ann.textBn,
      text: ann.textEn,
      link: ann.link,
      severity: ann.severity as AnnouncementSeverityDTO,
      isActive: ann.isActive,
      sortOrder: ann.sortOrder,
      startDate: ann.startDate ? ann.startDate.toISOString() : null,
      endDate: ann.endDate ? ann.endDate.toISOString() : null,
      createdAt: ann.createdAt.toISOString(),
      updatedAt: ann.updatedAt.toISOString(),
    };
  }

  /**
   * Admin: Create a new announcement
   */
  static async create(data: CreateAnnouncementInput, adminUserId: string): Promise<AnnouncementDTO> {
    const ann = await prisma.announcement.create({
      data: {
        textEn: data.textEn,
        textBn: data.textBn ?? null,
        link: data.link ?? null,
        severity: (data.severity as any) ?? "info",
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        createdById: adminUserId,
      },
    });

    await recordAuditLog({
      userId: adminUserId,
      action: "announcement.created",
      entityType: "Announcement",
      entityId: ann.id,
      metadata: { textEn: ann.textEn, severity: ann.severity },
    });

    return {
      id: ann.id,
      textEn: ann.textEn,
      textBn: ann.textBn,
      text: ann.textEn,
      link: ann.link,
      severity: ann.severity as AnnouncementSeverityDTO,
      isActive: ann.isActive,
      sortOrder: ann.sortOrder,
      startDate: ann.startDate ? ann.startDate.toISOString() : null,
      endDate: ann.endDate ? ann.endDate.toISOString() : null,
      createdAt: ann.createdAt.toISOString(),
      updatedAt: ann.updatedAt.toISOString(),
    };
  }

  /**
   * Admin: Update an existing announcement
   */
  static async update(
    id: string,
    data: UpdateAnnouncementInput,
    adminUserId: string
  ): Promise<AnnouncementDTO> {
    const existing = await this.getById(id);

    const updated = await prisma.announcement.update({
      where: { id: existing.id },
      data: {
        ...(data.textEn !== undefined ? { textEn: data.textEn } : {}),
        ...(data.textBn !== undefined ? { textBn: data.textBn } : {}),
        ...(data.link !== undefined ? { link: data.link } : {}),
        ...(data.severity !== undefined ? { severity: data.severity as any } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.startDate !== undefined
          ? { startDate: data.startDate ? new Date(data.startDate) : null }
          : {}),
        ...(data.endDate !== undefined
          ? { endDate: data.endDate ? new Date(data.endDate) : null }
          : {}),
      },
    });

    await recordAuditLog({
      userId: adminUserId,
      action: "announcement.updated",
      entityType: "Announcement",
      entityId: updated.id,
      metadata: { changes: Object.keys(data) },
    });

    return {
      id: updated.id,
      textEn: updated.textEn,
      textBn: updated.textBn,
      text: updated.textEn,
      link: updated.link,
      severity: updated.severity as AnnouncementSeverityDTO,
      isActive: updated.isActive,
      sortOrder: updated.sortOrder,
      startDate: updated.startDate ? updated.startDate.toISOString() : null,
      endDate: updated.endDate ? updated.endDate.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Admin: Toggle announcement active status
   */
  static async toggleActive(id: string, adminUserId: string): Promise<AnnouncementDTO> {
    const existing = await this.getById(id);

    const updated = await prisma.announcement.update({
      where: { id: existing.id },
      data: {
        isActive: !existing.isActive,
      },
    });

    await recordAuditLog({
      userId: adminUserId,
      action: "announcement.toggled",
      entityType: "Announcement",
      entityId: updated.id,
      metadata: { isActive: updated.isActive },
    });

    return {
      id: updated.id,
      textEn: updated.textEn,
      textBn: updated.textBn,
      text: updated.textEn,
      link: updated.link,
      severity: updated.severity as AnnouncementSeverityDTO,
      isActive: updated.isActive,
      sortOrder: updated.sortOrder,
      startDate: updated.startDate ? updated.startDate.toISOString() : null,
      endDate: updated.endDate ? updated.endDate.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Admin: Delete announcement
   */
  static async delete(id: string, adminUserId: string): Promise<void> {
    const existing = await this.getById(id);

    await prisma.announcement.delete({
      where: { id: existing.id },
    });

    await recordAuditLog({
      userId: adminUserId,
      action: "announcement.deleted",
      entityType: "Announcement",
      entityId: existing.id,
      metadata: { textEn: existing.textEn },
    });
  }
}

