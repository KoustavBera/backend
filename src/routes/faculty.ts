import { Hono } from "hono";
import { z } from "zod";
import { FacultyService } from "../services/faculty.service.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import type { AppEnv } from "../types/context.js";

export const facultyRouter = new Hono<AppEnv>();

const FACULTY_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=30";

const createFacultySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  nameBn: z.string().max(100).optional().nullable(),
  slug: z.string().max(100).optional().nullable(),
  designation: z.string().min(2, "Designation must be at least 2 characters").max(100),
  designationBn: z.string().max(100).optional().nullable(),
  department: z.string().max(100).optional(),
  education: z.string().min(2, "Education qualifications are required").max(200),
  educationBn: z.string().max(200).optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  photoKey: z.string().optional().nullable(),
  uploadIntentId: z.string().uuid().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

const updateFacultySchema = z.object({
  name: z.string().min(2).max(100).optional(),
  nameBn: z.string().max(100).optional().nullable(),
  slug: z.string().max(100).optional().nullable(),
  designation: z.string().min(2).max(100).optional(),
  designationBn: z.string().max(100).optional().nullable(),
  department: z.string().max(100).optional(),
  education: z.string().min(2).max(200).optional(),
  educationBn: z.string().max(200).optional().nullable(),
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
 * ── 1. GET /api/faculty ──────────────────────────────────────────────────────
 * Public: List active faculty members with resolved image URLs
 */
facultyRouter.get("/", async (c) => {
  const department = c.req.query("department") || c.req.query("dept");
  const faculty = await FacultyService.listActive(department);

  c.header("Cache-Control", FACULTY_CACHE_CONTROL);
  return c.json({ data: faculty });
});

/**
 * ── 2. GET /api/faculty/admin ────────────────────────────────────────────────
 * Admin: List all faculty members (active + inactive)
 */
facultyRouter.get("/admin", requireAuth, requireAdmin, async (c) => {
  const department = c.req.query("department") || c.req.query("dept");
  const faculty = await FacultyService.listAll(department);
  return c.json({ data: faculty });
});

/**
 * ── 3. POST /api/faculty/upload-url ──────────────────────────────────────────
 * Admin: Generate presigned upload URL for faculty photo
 */
facultyRouter.post("/upload-url", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json();
  const parsed = uploadUrlSchema.parse(body);
  const user = c.get("user")!;

  const result = await FacultyService.createUploadUrl({
    filename: parsed.filename,
    contentType: parsed.contentType,
    sizeBytes: parsed.sizeBytes,
    userId: user.id,
  });

  return c.json({ data: result }, 201);
});

/**
 * ── 4. GET /api/faculty/:id ──────────────────────────────────────────────────
 * Public: Get single faculty member by ID or slug
 */
facultyRouter.get("/:id", async (c) => {
  const idOrSlug = c.req.param("id");
  const member = await FacultyService.getByIdOrSlug(idOrSlug);

  c.header("Cache-Control", FACULTY_CACHE_CONTROL);
  return c.json({ data: member });
});

/**
 * ── 5. POST /api/faculty ─────────────────────────────────────────────────────
 * Admin: Create a new faculty member
 */
facultyRouter.post("/", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json();
  const parsed = createFacultySchema.parse(body);
  const user = c.get("user")!;
  const ip = c.req.header("x-forwarded-for") || undefined;

  const result = await FacultyService.create(parsed, user.id, ip);
  return c.json({ data: result }, 201);
});

/**
 * ── 6. PATCH /api/faculty/:id ────────────────────────────────────────────────
 * Admin: Update an existing faculty member
 */
facultyRouter.patch("/:id", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = updateFacultySchema.parse(body);
  const user = c.get("user")!;
  const ip = c.req.header("x-forwarded-for") || undefined;

  const result = await FacultyService.update(id, parsed, user.id, ip);
  return c.json({ data: result });
});

/**
 * ── 7. DELETE /api/faculty/:id ───────────────────────────────────────────────
 * Admin: Delete a faculty member
 */
facultyRouter.delete("/:id", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user")!;
  const ip = c.req.header("x-forwarded-for") || undefined;

  const result = await FacultyService.delete(id, user.id, ip);
  return c.json({ data: result });
});
