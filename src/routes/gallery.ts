import { Hono } from "hono";
import { z } from "zod";
import { GalleryService } from "../services/gallery.service.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import type { AppEnv } from "../types/context.js";

export const galleryRouter = new Hono<AppEnv>();

const GALLERY_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=30";

const categorySchema = z.enum(["campus", "events", "sports", "academics", "celebrations"]);

const createGalleryPhotoSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters").max(200),
  titleBn: z.string().max(200).optional().nullable(),
  category: categorySchema.optional().default("campus"),
  description: z.string().max(1000).optional().nullable(),
  photoKey: z.string().optional().nullable(),
  uploadIntentId: z.string().uuid().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

const updateGalleryPhotoSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  titleBn: z.string().max(200).optional().nullable(),
  category: categorySchema.optional(),
  description: z.string().max(1000).optional().nullable(),
  photoKey: z.string().optional().nullable(),
  uploadIntentId: z.string().uuid().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
});

const uploadUrlSchema = z.object({
  filename: z.string().min(1, "Filename is required"),
  contentType: z.string().min(1, "Content type is required"),
  sizeBytes: z.number().int().positive("Size must be positive"),
});

/**
 * ── 1. GET /api/gallery ──────────────────────────────────────────────────────
 * Public: List active photos with signed or resolved URLs
 */
galleryRouter.get("/", async (c) => {
  const category = c.req.query("category") || c.req.query("cat");
  const photos = await GalleryService.listActive(category);

  c.header("Cache-Control", GALLERY_CACHE_CONTROL);
  return c.json({ data: photos });
});

/**
 * ── 2. GET /api/gallery/admin ────────────────────────────────────────────────
 * Admin: List all gallery photos (active + inactive)
 */
galleryRouter.get("/admin", requireAuth, requireAdmin, async (c) => {
  const category = c.req.query("category") || c.req.query("cat");
  const photos = await GalleryService.listAll(category);
  return c.json({ data: photos });
});

/**
 * ── 3. POST /api/gallery/upload-url ──────────────────────────────────────────
 * Admin: Generate presigned upload URL for gallery photo
 */
galleryRouter.post("/upload-url", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json();
  const parsed = uploadUrlSchema.parse(body);
  const user = c.get("user")!;

  const result = await GalleryService.createUploadUrl({
    filename: parsed.filename,
    contentType: parsed.contentType,
    sizeBytes: parsed.sizeBytes,
    userId: user.id,
  });

  return c.json({ data: result }, 201);
});

/**
 * ── 4. GET /api/gallery/:id ──────────────────────────────────────────────────
 * Public: Get single gallery photo by ID
 */
galleryRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const photo = await GalleryService.getById(id);

  c.header("Cache-Control", GALLERY_CACHE_CONTROL);
  return c.json({ data: photo });
});

/**
 * ── 5. POST /api/gallery ─────────────────────────────────────────────────────
 * Admin: Create a new gallery photo
 */
galleryRouter.post("/", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json();
  const parsed = createGalleryPhotoSchema.parse(body);
  const user = c.get("user")!;
  const ip = c.req.header("x-forwarded-for") || undefined;

  const result = await GalleryService.create(parsed, user.id, ip);
  return c.json({ data: result }, 201);
});

/**
 * ── 6. PATCH /api/gallery/:id ────────────────────────────────────────────────
 * Admin: Update an existing gallery photo
 */
galleryRouter.patch("/:id", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = updateGalleryPhotoSchema.parse(body);
  const user = c.get("user")!;
  const ip = c.req.header("x-forwarded-for") || undefined;

  const result = await GalleryService.update(id, parsed, user.id, ip);
  return c.json({ data: result });
});

/**
 * ── 7. DELETE /api/gallery/:id ───────────────────────────────────────────────
 * Admin: Delete a gallery photo
 */
galleryRouter.delete("/:id", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user")!;
  const ip = c.req.header("x-forwarded-for") || undefined;

  const result = await GalleryService.delete(id, user.id, ip);
  return c.json({ data: result });
});

