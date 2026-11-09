import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../src/index.js";
import { prisma } from "../src/db/prisma.js";

describe("Dynamic Photo Gallery API (/api/gallery)", () => {
  let adminCookie = "";
  let teacherCookie = "";
  let createdPhotoId = "";
  const testTitle = `Test Gallery Photo ${Date.now()}`;

  afterAll(async () => {
    try {
      await prisma.galleryPhoto.deleteMany({
        where: { title: { startsWith: "Test Gallery Photo" } },
      });
    } catch {
      // ignore
    }
  });

  beforeAll(async () => {
    // Retry loop to safely absorb Neon serverless wakeups
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // 1. Login as Admin
    const adminRes = await app.fetch(
      new Request("http://localhost:5000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@durgapurhighschool.in",
          password: "Password123!",
        }),
      })
    );
    for (const c of adminRes.headers.getSetCookie()) {
      if (c.startsWith("durg_access=")) adminCookie = c.split(";")[0];
    }

    // 2. Login as Teacher (non-admin)
    const teacherRes = await app.fetch(
      new Request("http://localhost:5000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "anirban.banerjee@durgapurhighschool.in",
          password: "Password123!",
        }),
      })
    );
    for (const c of teacherRes.headers.getSetCookie()) {
      if (c.startsWith("durg_access=")) teacherCookie = c.split(";")[0];
    }
  }, 30000);

  it("1. GET /api/gallery returns active photos with Cache-Control headers", async () => {
    const res = await app.fetch(new Request("http://localhost:5000/api/gallery"));
    expect(res.status).toBe(200);

    const cacheHeader = res.headers.get("cache-control");
    expect(cacheHeader).toContain("public");
    expect(cacheHeader).toContain("s-maxage=60");

    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThan(0);

    const first = body.data[0];
    expect(first.id).toBeDefined();
    expect(first.title).toBeDefined();
    expect(first.category).toBeDefined();
    expect(first.url).toBeDefined();
    expect(first.url.length).toBeGreaterThan(0);
  }, 20000);

  it("2. GET /api/gallery?category=events filters photos by category", async () => {
    const res = await app.fetch(new Request("http://localhost:5000/api/gallery?category=events"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThan(0);
    for (const photo of body.data) {
      expect(photo.category).toBe("events");
    }
  }, 20000);

  it("3. GET /api/gallery/:id retrieves single gallery photo", async () => {
    // Get list first
    const listRes = await app.fetch(new Request("http://localhost:5000/api/gallery"));
    const listBody = await listRes.json();
    const target = listBody.data[0];

    const res = await app.fetch(new Request(`http://localhost:5000/api/gallery/${target.id}`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.id).toBe(target.id);
    expect(body.data.title).toBe(target.title);
    expect(body.data.url).toBe(target.url);

    // 404 for invalid/nonexistent ID
    const notFoundRes = await app.fetch(
      new Request("http://localhost:5000/api/gallery/00000000-0000-0000-0000-000000000000")
    );
    expect(notFoundRes.status).toBe(404);
  }, 20000);

  it("4. Non-admin users are blocked from admin endpoints", async () => {
    // 4.1 Unauthenticated POST
    const anonRes = await app.fetch(
      new Request("http://localhost:5000/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Unauthorized Photo",
          photoKey: "/photos/test.jpg",
        }),
      })
    );
    expect(anonRes.status).toBe(401);

    // 4.2 Teacher (non-admin) POST
    const teacherPostRes = await app.fetch(
      new Request("http://localhost:5000/api/gallery", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: teacherCookie,
        },
        body: JSON.stringify({
          title: "Teacher Photo Attempt",
          photoKey: "/photos/test.jpg",
        }),
      })
    );
    expect(teacherPostRes.status).toBe(403);

    // 4.3 Teacher (non-admin) upload URL
    const teacherUploadRes = await app.fetch(
      new Request("http://localhost:5000/api/gallery/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: teacherCookie,
        },
        body: JSON.stringify({
          filename: "test.jpg",
          contentType: "image/jpeg",
          sizeBytes: 1024,
        }),
      })
    );
    expect(teacherUploadRes.status).toBe(403);

    // 4.4 Teacher (non-admin) GET /admin
    const teacherAdminListRes = await app.fetch(
      new Request("http://localhost:5000/api/gallery/admin", {
        headers: { Cookie: teacherCookie },
      })
    );
    expect(teacherAdminListRes.status).toBe(403);
  }, 20000);

  it("5. Admin can generate photo upload URL", async () => {
    // 5.1 Success case
    const res = await app.fetch(
      new Request("http://localhost:5000/api/gallery/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          filename: "campus-photo.webp",
          contentType: "image/webp",
          sizeBytes: 524288,
        }),
      })
    );
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.data.uploadUrl).toBeDefined();
    expect(body.data.uploadIntentId).toBeDefined();
    expect(body.data.objectKey).toContain("gallery/");

    // 5.2 Invalid MIME type rejected
    const badMimeRes = await app.fetch(
      new Request("http://localhost:5000/api/gallery/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          filename: "document.pdf",
          contentType: "application/pdf",
          sizeBytes: 1024,
        }),
      })
    );
    expect(badMimeRes.status).toBe(400);
  }, 20000);

  it("6. Admin can create a new gallery photo", async () => {
    const res = await app.fetch(
      new Request("http://localhost:5000/api/gallery", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          title: testTitle,
          titleBn: "টেস্ট গ্যালারি ফটো",
          category: "sports",
          description: "Annual sports meet test event",
          photoKey: "/photos/sports_preview.jpg",
          sortOrder: 45,
          isActive: true,
        }),
      })
    );
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.title).toBe(testTitle);
    expect(body.data.category).toBe("sports");
    expect(body.data.url).toBe("/photos/sports_preview.jpg");
    expect(body.data.sortOrder).toBe(45);

    createdPhotoId = body.data.id;
  }, 20000);

  it("7. Admin can update an existing gallery photo", async () => {
    expect(createdPhotoId).toBeDefined();

    const res = await app.fetch(
      new Request(`http://localhost:5000/api/gallery/${createdPhotoId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          title: `${testTitle} - Updated`,
          category: "celebrations",
          sortOrder: 10,
          isActive: false,
        }),
      })
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.title).toBe(`${testTitle} - Updated`);
    expect(body.data.category).toBe("celebrations");
    expect(body.data.sortOrder).toBe(10);
    expect(body.data.isActive).toBe(false);

    // Verify it is excluded from public list because isActive=false
    const publicRes = await app.fetch(new Request("http://localhost:5000/api/gallery"));
    const publicBody = await publicRes.json();
    const foundInPublic = publicBody.data.some((p: { id: string }) => p.id === createdPhotoId);
    expect(foundInPublic).toBe(false);

    // But included in admin list
    const adminRes = await app.fetch(
      new Request("http://localhost:5000/api/gallery/admin", {
        headers: { Cookie: adminCookie },
      })
    );
    expect(adminRes.status).toBe(200);
    const adminBody = await adminRes.json();
    const foundInAdmin = adminBody.data.some((p: { id: string }) => p.id === createdPhotoId);
    expect(foundInAdmin).toBe(true);
  }, 20000);

  it("8. Admin can delete a gallery photo", async () => {
    expect(createdPhotoId).toBeDefined();

    const res = await app.fetch(
      new Request(`http://localhost:5000/api/gallery/${createdPhotoId}`, {
        method: "DELETE",
        headers: {
          Cookie: adminCookie,
        },
      })
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.success).toBe(true);

    // Verify it is no longer returned
    const getRes = await app.fetch(
      new Request(`http://localhost:5000/api/gallery/${createdPhotoId}`)
    );
    expect(getRes.status).toBe(404);
  }, 20000);
});

