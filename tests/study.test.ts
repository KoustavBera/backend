import { describe, it, expect, beforeAll } from "bun:test";
import app from "../src/index";
import { prisma } from "../src/db/prisma";

describe("Phase 3: Study Zone API Tests", () => {
  let teacherToken = "";
  let unassignedTeacherToken = "";

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

    // Login Teacher 1 (assigned to class-9 and class-10)
    const t1Res = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "anirban.banerjee@durgapurhighschool.in",
          password: "Password123!",
        }),
      })
    );
    for (const c of t1Res.headers.getSetCookie()) {
      if (c.startsWith("durg_access=")) teacherToken = c.split(";")[0];
    }

    // Login Teacher 2 (assigned to class-11 and class-12)
    const t2Res = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "mousumi.roy@durgapurhighschool.in",
          password: "Password123!",
        }),
      })
    );
    for (const c of t2Res.headers.getSetCookie()) {
      if (c.startsWith("durg_access=")) unassignedTeacherToken = c.split(";")[0];
    }
  }, 30000);

  it("1. GET /api/study/classes/class-10/subjects returns subject list with resource counts", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/study/classes/class-10/subjects")
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(7);

    const math = body.data.find((s: any) => s.id === "mathematics");
    expect(math).toBeDefined();
    expect(math.name).toBe("Mathematics");
    expect(math.classId).toBe("class-10");
    expect(math.resourceCount).toBe(7); // Seeded sample resources
    expect(math.tone).toBeDefined();
  });

  it("2. GET /api/study/classes/class-10/subjects/mathematics returns subject details", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/study/classes/class-10/subjects/mathematics")
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe("mathematics");
    expect(body.data.name).toBe("Mathematics");
    expect(body.data.classId).toBe("class-10");
    expect(body.data.tone).toBeDefined();
  });

  it("3. GET /api/study/classes/class-10/subjects/mathematics/resources returns published materials", async () => {
    const res = await app.fetch(
      new Request(
        "http://localhost/api/study/classes/class-10/subjects/mathematics/resources"
      )
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(7);

    const video = body.data.find((r: any) => r.format === "youtube");
    expect(video).toBeDefined();
    expect(video.url).toContain("youtube.com");
    expect(video.category).toBe("video");
    expect(video.classId).toBe("class-10");
    expect(video.subjectId).toBe("mathematics");

    const pdf = body.data.find((r: any) => r.format === "pdf");
    expect(pdf).toBeDefined();
    expect(pdf.url).toContain(".pdf");
  });

  it("4. POST /api/study/classes/class-9/subjects allows assigned teacher to add subject", async () => {
    const testSubjectName = `Robotics ${Date.now()}`;
    const res = await app.fetch(
      new Request("http://localhost/api/study/classes/class-9/subjects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: teacherToken,
        },
        body: JSON.stringify({
          name: testSubjectName,
          bn: "রোবোটিক্স",
          icon: "cpu",
        }),
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe(testSubjectName);
    expect(body.data.classId).toBe("class-9");
    expect(body.data.icon).toBe("cpu");

    // Clean up
    await app.fetch(
      new Request(`http://localhost/api/study/classes/class-9/subjects/${body.data.id}`, {
        method: "DELETE",
        headers: { Cookie: teacherToken },
      })
    );
  });

  it("5. Rejects subject creation when teacher is not assigned to that class (403)", async () => {
    // Teacher 1 is assigned only to class-9 and class-10, NOT class-12
    const res = await app.fetch(
      new Request("http://localhost/api/study/classes/class-12/subjects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: teacherToken,
        },
        body: JSON.stringify({
          name: "Astronomy",
          icon: "atom",
        }),
      })
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

