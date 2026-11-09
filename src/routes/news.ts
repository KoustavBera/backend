import { Hono } from "hono";
import { AppError } from "../lib/errors.js";
import { NewsService } from "../services/news.service.js";
import type { AppEnv } from "../types/context.js";

export const newsRouter = new Hono<AppEnv>();

// Public news cache header: Next.js ISR caches, edge caches for 60s, serves stale for 30s while revalidating
const NEWS_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=30";

/**
 * GET /api/news
 * List all published news articles
 */
newsRouter.get("/", async (c) => {
  const articles = await NewsService.listArticles();
  c.header("Cache-Control", NEWS_CACHE_CONTROL);
  return c.json({ data: articles });
});

/**
 * GET /api/news/:slug/related
 * Get related articles for a given article
 * (Registered before /:slug to prevent path conflicts)
 */
newsRouter.get("/:slug/related", async (c) => {
  const { slug } = c.req.param();
  const limitQuery = c.req.query("limit");
  const limit = limitQuery ? Math.min(Math.max(parseInt(limitQuery, 10) || 4, 1), 10) : 4;

  const related = await NewsService.getRelatedArticles(slug, limit);
  c.header("Cache-Control", NEWS_CACHE_CONTROL);
  return c.json({ data: related });
});

/**
 * GET /api/news/:slug
 * Get article detail by slug
 */
newsRouter.get("/:slug", async (c) => {
  const { slug } = c.req.param();
  const article = await NewsService.getArticleBySlug(slug);

  if (!article) {
    throw AppError.notFound("Article not found");
  }

  c.header("Cache-Control", NEWS_CACHE_CONTROL);
  return c.json({ data: article });
});

