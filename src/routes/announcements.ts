import { Hono } from "hono";
import { z } from "zod";
import { AnnouncementService } from "../services/announcement.service.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import type { AppEnv } from "../types/context.js";

export const announcementsRouter = new Hono<AppEnv>();

const ANNOUNCEMENT_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=30";

const severityEnum = z.enum(["info", "warning", "urgent"]);

const createAnnouncementSchema = z.object({
  textEn: z.string().min(2, "English announcement text is required").max(500),
  textBn: z.string().max(500).optional().nullable(),
  link: z.string().max(500).optional().nullable(),
  severity: severityEnum.optional().default("info"),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(1000).optional().default(0),
  startDate: z.string().datetime({ offset: true }).optional().nullable(),
  endDate: z.string().datetime({ offset: true }).optional().nullable(),
});

const updateAnnouncementSchema = z.object({
  textEn: z.string().min(2).max(500).optional(),
  textBn: z.string().max(500).optional().nullable(),
  link: z.string().max(500).optional().nullable(),
  severity: severityEnum.optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  startDate: z.string().datetime({ offset: true }).optional().nullable(),
  endDate: z.string().datetime({ offset: true }).optional().nullable(),
});

/**
 * ── 1. GET /api/announcements ────────────────────────────────────────────────
 * Public: List all active announcements valid for the current time
 */
announcementsRouter.get("/", async (c) => {
  const lang = (c.req.query("lang") === "bn" ? "bn" : "en") as "en" | "bn";
  const announcements = await AnnouncementService.listActive(lang);

  c.header("Cache-Control", ANNOUNCEMENT_CACHE_CONTROL);
  return c.json({ data: announcements });
});

/**
 * ── 2. GET /api/announcements/admin ──────────────────────────────────────────
 * Admin: List all announcements with scheduling metadata
 */
announcementsRouter.get("/admin", requireAuth, requireAdmin, async (c) => {
  const result = await AnnouncementService.listAll();
  return c.json({ data: result });
});

/**
 * ── 3. GET /api/announcements/:id ────────────────────────────────────────────
 * Admin: Get specific announcement detail
 */
announcementsRouter.get("/:id", requireAuth, requireAdmin, async (c) => {
  const { id } = c.req.param();
  const announcement = await AnnouncementService.getById(id);
  return c.json({ data: announcement });
});

/**
 * ── 4. POST /api/announcements ───────────────────────────────────────────────
 * Admin: Create a new announcement
 */
announcementsRouter.post("/", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json();
  const validated = createAnnouncementSchema.parse(body);
  const user = c.get("user")!;

  const created = await AnnouncementService.create(validated, user.id);
  return c.json({ data: created }, 201);
});

/**
 * ── 5. PATCH /api/announcements/:id ──────────────────────────────────────────
 * Admin: Update announcement fields
 */
announcementsRouter.patch("/:id", requireAuth, requireAdmin, async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const validated = updateAnnouncementSchema.parse(body);
  const user = c.get("user")!;

  const updated = await AnnouncementService.update(id, validated, user.id);
  return c.json({ data: updated });
});

/**
 * ── 6. PATCH /api/announcements/:id/toggle ───────────────────────────────────
 * Admin: Quickly toggle active/inactive status
 */
announcementsRouter.patch("/:id/toggle", requireAuth, requireAdmin, async (c) => {
  const { id } = c.req.param();
  const user = c.get("user")!;

  const updated = await AnnouncementService.toggleActive(id, user.id);
  return c.json({ data: updated });
});

/**
 * ── 7. DELETE /api/announcements/:id ─────────────────────────────────────────
 * Admin: Delete announcement
 */
announcementsRouter.delete("/:id", requireAuth, requireAdmin, async (c) => {
  const { id } = c.req.param();
  const user = c.get("user")!;

  await AnnouncementService.delete(id, user.id);
  return c.json({ data: { success: true } });
});

