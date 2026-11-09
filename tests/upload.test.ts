import { describe, it, expect, beforeAll } from "bun:test";
import app from "../src/index";
import { prisma } from "../src/db/prisma";
import { CleanupService } from "../src/services/cleanup.service";

describe("Phase 4: Upload Intents, Resource Publishing & Deletion Queue Tests", () => {
  let teacherCookie = "";
  let createdResourceId = "";
  let intentId = "";
  let objectKey = "";

  beforeAll(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Login Teacher 1 (assigned to class-9 & class-10)
    const loginRes = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "anirban.banerjee@durgapurhighschool.in",
          password: "Password123!",
        }),
      })
    );

    for (const c of loginRes.headers.getSetCookie()) {
      if (c.startsWith("durg_access=")) teacherCookie = c.split(";")[0];
    }
  }, 30000);

  it("1. POST /api/study/upload-url generates pre-signed upload intent", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/study/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: teacherCookie,
        },
        body: JSON.stringify({
          classId: "class-9",
          subjectId: "mathematics",
          filename: "algebra_handout.pdf",
          contentType: "application/pdf",
          bytes: 1024 * 1024, // 1 MB
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.uploadUrl).toBeDefined();
    expect(body.data.objectKey).toContain("uploads/resources/class-");
    expect(body.data.intentId).toBeDefined();
    expect(body.data.expiresAt).toBeDefined();

    intentId = body.data.intentId;
    objectKey = body.data.objectKey;

    // Verify row in upload_intents table
    const intentInDb = await prisma.uploadIntent.findUnique({
      where: { id: intentId },
    });
    expect(intentInDb).toBeDefined();
    expect(intentInDb?.finalizedAt).toBeNull();
  });

  it("2. POST /api/study/classes/class-9/subjects/mathematics/resources creates draft with intent", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/study/classes/class-9/subjects/mathematics/resources", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: teacherCookie,
        },
        body: JSON.stringify({
          category: "notes",
          format: "pdf",
          title: "Algebra Handout Chapter 1",
          chapter: "Chapter 1",
          intentId,
          academic_year: "2025-26",
        }),
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.title).toBe("Algebra Handout Chapter 1");
    expect(body.data.format).toBe("pdf");

    createdResourceId = body.data.id;

    // Verify intent is finalized
    const finalizedIntent = await prisma.uploadIntent.findUnique({
      where: { id: intentId },
    });
    expect(finalizedIntent?.finalizedAt).not.toBeNull();
  });

  it("3. Drafts appear in /drafts endpoint but NOT in public list", async () => {
    // 1. Public list should NOT include draft
    const publicRes = await app.fetch(
      new Request("http://localhost/api/study/classes/class-9/subjects/mathematics/resources")
    );
    const publicBody = await publicRes.json();
    const foundInPublic = publicBody.data.some((r: any) => r.id === createdResourceId);
    expect(foundInPublic).toBe(false);

    // 2. Drafts list should include it
    const draftsRes = await app.fetch(
      new Request(
        "http://localhost/api/study/classes/class-9/subjects/mathematics/resources/drafts",
        {
          headers: { Cookie: teacherCookie },
        }
      )
    );
    expect(draftsRes.status).toBe(200);
    const draftsBody = await draftsRes.json();
    const foundInDrafts = draftsBody.data.some((r: any) => r.id === createdResourceId);
    expect(foundInDrafts).toBe(true);
  });

  it("4. PATCH /api/study/resources/:resourceId/publish publishes draft", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/study/resources/${createdResourceId}/publish`, {
        method: "PATCH",
        headers: { Cookie: teacherCookie },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(true);

    // Now it should be visible in public list
    const publicRes = await app.fetch(
      new Request("http://localhost/api/study/classes/class-9/subjects/mathematics/resources")
    );
    const publicBody = await publicRes.json();
    const foundInPublic = publicBody.data.some((r: any) => r.id === createdResourceId);
    expect(foundInPublic).toBe(true);
  });

  it("5. DELETE /api/study/resources/:resourceId queues permanent file in pending_deletions", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/study/resources/${createdResourceId}`, {
        method: "DELETE",
        headers: { Cookie: teacherCookie },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(true);

    // Verify resource is deleted from DB
    const deletedRes = await prisma.resource.findUnique({
      where: { id: createdResourceId },
    });
    expect(deletedRes).toBeNull();

    // Verify file objectKey was transactionally queued in pending_deletions
    const queuedTask = await prisma.pendingDeletion.findFirst({
      where: { objectKey },
    });
    expect(queuedTask).toBeDefined();
    expect(queuedTask?.objectKey).toBe(objectKey);
  });

  it("6. CleanupService drains pending deletions queue", async () => {
    const drained = await CleanupService.drainPendingDeletions();
    expect(drained).toBeGreaterThanOrEqual(1);

    const task = await prisma.pendingDeletion.findFirst({
      where: { objectKey },
    });
    expect(task?.status).toBe("completed");
  });
});
