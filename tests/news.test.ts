import { describe, expect, test, beforeAll } from "bun:test";
import app from "../src/index.js";
import { prisma } from "../src/db/prisma.js";

describe("Phase 5: News API Integration", () => {
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
  }, 30000);

  test("GET /api/news returns published articles with Cache-Control headers", async () => {
    const res = await app.fetch(new Request("http://localhost:5000/api/news"));
    expect(res.status).toBe(200);

    const cacheHeader = res.headers.get("cache-control");
    expect(cacheHeader).toContain("public");
    expect(cacheHeader).toContain("s-maxage=60");
    expect(cacheHeader).toContain("stale-while-revalidate=30");

    const json = await res.json();
    expect(json.data).toBeDefined();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThanOrEqual(6);

    const first = json.data[0];
    expect(first.id).toBeDefined();
    expect(first.slug).toBeDefined();
    expect(first.title).toBeDefined();
    expect(first.tag).toBeDefined();
    expect(first.category).toBeDefined();
    expect(first.date).toBeDefined();
    expect(first.publishedAt).toBeDefined();
    expect(first.desc).toBeDefined();
  });

  test("GET /api/news/:slug returns single article with body, attachments, and related slugs", async () => {
    const slug = "cbse-class-x-results-100-percent";
    const res = await app.fetch(new Request(`http://localhost:5000/api/news/${slug}`));
    expect(res.status).toBe(200);

    const cacheHeader = res.headers.get("cache-control");
    expect(cacheHeader).toContain("public");
    expect(cacheHeader).toContain("s-maxage=60");

    const json = await res.json();
    expect(json.data).toBeDefined();
    expect(json.data.slug).toBe(slug);
    expect(Array.isArray(json.data.body)).toBe(true);
    expect(json.data.body.length).toBeGreaterThan(0);

    // Check attachments
    expect(Array.isArray(json.data.attachments)).toBe(true);
    if (json.data.attachments.length > 0) {
      const att = json.data.attachments[0];
      expect(att.id).toBeDefined();
      expect(att.title).toBeDefined();
      expect(att.url).toBeDefined();
      expect(att.type).toBeDefined();
      expect(att.size).toBeDefined();
    }

    // Check related slugs
    expect(Array.isArray(json.data.relatedSlugs)).toBe(true);
    expect(json.data.relatedSlugs.length).toBeGreaterThan(0);
  });

  test("GET /api/news/:slug returns 404 for non-existent slug", async () => {
    const res = await app.fetch(
      new Request("http://localhost:5000/api/news/non-existent-article-slug")
    );
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe("NOT_FOUND");
  });

  test("GET /api/news/:slug/related returns related articles with limit", async () => {
    const slug = "cbse-class-x-results-100-percent";
    const res = await app.fetch(
      new Request(`http://localhost:5000/api/news/${slug}/related?limit=2`)
    );
    expect(res.status).toBe(200);

    const cacheHeader = res.headers.get("cache-control");
    expect(cacheHeader).toContain("public");

    const json = await res.json();
    expect(json.data).toBeDefined();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeLessThanOrEqual(2);

    // Make sure the requested article itself is not in the related articles
    const hasSelf = json.data.some((a: any) => a.slug === slug);
    expect(hasSelf).toBe(false);
  });
});

