import { Hono } from "hono";
import { z } from "zod";
import { StudyService } from "../services/study.service";
import { requireAuth, requireClassAccess } from "../middleware/auth";
import type { AppEnv } from "../types/context";
import { ResourceCategory, ResourceFormat } from "@prisma/client";

const study = new Hono<AppEnv>();

// Always set no-store for study zone so edits reflect immediately
study.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

// ── Validation Schemas ────────────────────────────────────────────────────────
const createSubjectSchema = z.object({
  name: z.string().min(1, "Subject name is required").max(100),
  bn: z.string().max(100).optional(),
  icon: z.string().default("book"),
});

const uploadUrlSchema = z.object({
  classId: z.string().optional(),
  subjectId: z.string().min(1, "subjectId is required"),
  filename: z.string().min(1, "filename is required"),
  contentType: z.string().min(1, "contentType is required"),
  bytes: z.number().int().positive().max(10 * 1024 * 1024, "Max file size is 10 MB"),
});

const createResourceSchema = z.object({
  category: z.nativeEnum(ResourceCategory),
  format: z.nativeEnum(ResourceFormat),
  title: z.string().min(1, "Title is required").max(200),
  chapter: z.string().max(60).optional(),
  intentId: z.string().uuid().optional(),
  youtube_url: z.string().url().optional(),
  academic_year: z
    .string()
    .regex(/^[0-9]{4}-[0-9]{2}$/, "academic_year must match YYYY-YY (e.g. 2025-26)"),
});

// ── 1. GET /api/study/classes/:classId/subjects ───────────────────────────────
study.get("/classes/:classId/subjects", async (c) => {
  const classId = c.req.param("classId");
  const subjects = await StudyService.listSubjects(classId);
  return c.json({ data: subjects });
});

// ── 2. GET /api/study/classes/:classId/subjects/:subjectId ────────────────────
study.get("/classes/:classId/subjects/:subjectId", async (c) => {
  const classId = c.req.param("classId");
  const subjectId = c.req.param("subjectId");
  const subject = await StudyService.getSubject(classId, subjectId);
  return c.json({ data: subject });
});

// ── 3. POST /api/study/classes/:classId/subjects ──────────────────────────────
study.post(
  "/classes/:classId/subjects",
  requireAuth,
  requireClassAccess("classId"),
  async (c) => {
    const classId = c.req.param("classId");
    const body = await c.req.json();
    const validated = createSubjectSchema.parse(body);
    const user = c.get("user")!;

    const subject = await StudyService.createSubject(
      {
        classId,
        name: validated.name,
        bn: validated.bn,
        icon: validated.icon,
      },
      user
    );

    return c.json({ data: subject }, 201);
  }
);

// ── 4. DELETE /api/study/classes/:classId/subjects/:subjectId ─────────────────
study.delete(
  "/classes/:classId/subjects/:subjectId",
  requireAuth,
  requireClassAccess("classId"),
  async (c) => {
    const classId = c.req.param("classId");
    const subjectId = c.req.param("subjectId");
    const user = c.get("user")!;

    await StudyService.deleteSubject(classId, subjectId, user);
    return c.json({ data: { ok: true } });
  }
);

// ── 5. POST /api/study/upload-url (Generate Pre-signed Upload URL) ─────────────
study.post("/upload-url", requireAuth, async (c) => {
  const body = await c.req.json();
  const validated = uploadUrlSchema.parse(body);
  const user = c.get("user")!;

  const result = await StudyService.generateUploadUrl(validated, user);
  return c.json({ data: result });
});

// ── 6. POST /api/study/classes/:classId/subjects/:subjectId/resources ─────────
study.post(
  "/classes/:classId/subjects/:subjectId/resources",
  requireAuth,
  requireClassAccess("classId"),
  async (c) => {
    const classId = c.req.param("classId");
    const subjectId = c.req.param("subjectId");
    const body = await c.req.json();
    const validated = createResourceSchema.parse(body);
    const user = c.get("user")!;

    const resource = await StudyService.createResource(
      {
        classId,
        subjectSlug: subjectId,
        category: validated.category,
        format: validated.format,
        title: validated.title,
        chapter: validated.chapter,
        intentId: validated.intentId,
        youtubeUrl: validated.youtube_url,
        academicYear: validated.academic_year,
      },
      user
    );

    return c.json({ data: resource }, 201);
  }
);

// ── 7. PATCH /api/study/resources/:resourceId/publish ─────────────────────────
study.patch("/resources/:resourceId/publish", requireAuth, async (c) => {
  const resourceId = c.req.param("resourceId");
  const user = c.get("user")!;

  await StudyService.publishResource(resourceId, user);
  return c.json({ data: { ok: true } });
});

// ── 8. DELETE /api/study/resources/:resourceId ────────────────────────────────
study.delete("/resources/:resourceId", requireAuth, async (c) => {
  const resourceId = c.req.param("resourceId");
  const user = c.get("user")!;

  await StudyService.deleteResource(resourceId, user);
  return c.json({ data: { ok: true } });
});

// ── 9. GET /api/study/classes/:classId/subjects/:subjectId/resources ──────────
study.get("/classes/:classId/subjects/:subjectId/resources", async (c) => {
  const classId = c.req.param("classId");
  const subjectId = c.req.param("subjectId");
  const year = c.req.query("year");

  const resources = await StudyService.listResources(classId, subjectId, year);
  return c.json({ data: resources });
});

// ── 10. GET /api/study/classes/:classId/subjects/:subjectId/resources/drafts ──
study.get(
  "/classes/:classId/subjects/:subjectId/resources/drafts",
  requireAuth,
  requireClassAccess("classId"),
  async (c) => {
    const classId = c.req.param("classId");
    const subjectId = c.req.param("subjectId");
    const user = c.get("user")!;

    const drafts = await StudyService.listDrafts(classId, subjectId, user);
    return c.json({ data: drafts });
  }
);

export { study };
