import { prisma } from "../db/prisma.js";
import type { NewsArticleDTO, NewsAttachmentDTO } from "../dtos/news.dto.js";
import { StorageService } from "./storage.service.js";

function formatBytes(bytes?: bigint | number | null): string {
  if (!bytes) return "0 KB";
  const num = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${Math.round(num / 1024)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPublishedAt(date?: Date | null, fallbackDateDisplay?: string): string {
  if (!date) return fallbackDateDisplay || "";
  try {
    const formatted = new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }).format(date);
    return formatted.replace(", ", " • ") + " IST";
  } catch {
    return date.toISOString();
  }
}

export class NewsService {
  /**
   * List all published news articles ordered by publication date (descending)
   */
  static async listArticles(): Promise<NewsArticleDTO[]> {
    const articles = await prisma.newsArticle.findMany({
      where: { isPublished: true },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      include: {
        attachments: {
          orderBy: { sortOrder: "asc" },
        },
        relationsFrom: {
          orderBy: { sortOrder: "asc" },
          include: {
            relatedArticle: {
              select: { slug: true },
            },
          },
        },
      },
    });

    return Promise.all(
      articles.map(async (art) => {
        const attachments: NewsAttachmentDTO[] = await Promise.all(
          art.attachments.map(async (att) => {
            let url = att.objectKey;
            if (url && !url.startsWith("http") && !url.startsWith("/")) {
              try {
                url = await StorageService.getDownloadUrl(url);
              } catch {
                // Keep raw objectKey if presigning fails
              }
            }
            return {
              id: att.id,
              title: att.title,
              url,
              type: att.type as "pdf" | "zip" | "doc" | "image",
              size: formatBytes(att.sizeBytes),
            };
          })
        );

        const relatedSlugs = art.relationsFrom.map((rel) => rel.relatedArticle.slug);

        return {
          id: art.id,
          slug: art.slug,
          tag: art.tag,
          category: art.category,
          title: art.title,
          date: art.dateDisplay,
          publishedAt: formatPublishedAt(art.publishedAt, art.dateDisplay),
          location: art.location,
          image: art.imageKey || "",
          imageCaption: art.imageCaption ?? undefined,
          desc: art.description,
          lead: art.lead ?? undefined,
          body: (art.body as string[]) || [],
          quote: (art.quote as NewsArticleDTO["quote"]) ?? undefined,
          author: (art.articleAuthor as NewsArticleDTO["author"]) ?? undefined,
          attachments,
          relatedSlugs,
        };
      })
    );
  }

  /**
   * Get single published article by slug
   */
  static async getArticleBySlug(slug: string): Promise<NewsArticleDTO | null> {
    const art = await prisma.newsArticle.findUnique({
      where: { slug },
      include: {
        attachments: {
          orderBy: { sortOrder: "asc" },
        },
        relationsFrom: {
          orderBy: { sortOrder: "asc" },
          include: {
            relatedArticle: {
              select: { slug: true },
            },
          },
        },
      },
    });

    if (!art || !art.isPublished) {
      return null;
    }

    const attachments: NewsAttachmentDTO[] = await Promise.all(
      art.attachments.map(async (att) => {
        let url = att.objectKey;
        if (url && !url.startsWith("http") && !url.startsWith("/")) {
          try {
            url = await StorageService.getDownloadUrl(url);
          } catch {
            // Keep raw objectKey if presigning fails
          }
        }
        return {
          id: att.id,
          title: att.title,
          url,
          type: att.type as "pdf" | "zip" | "doc" | "image",
          size: formatBytes(att.sizeBytes),
        };
      })
    );

    const relatedSlugs = art.relationsFrom.map((rel) => rel.relatedArticle.slug);

    return {
      id: art.id,
      slug: art.slug,
      tag: art.tag,
      category: art.category,
      title: art.title,
      date: art.dateDisplay,
      publishedAt: formatPublishedAt(art.publishedAt, art.dateDisplay),
      location: art.location,
      image: art.imageKey || "",
      imageCaption: art.imageCaption ?? undefined,
      desc: art.description,
      lead: art.lead ?? undefined,
      body: (art.body as string[]) || [],
      quote: (art.quote as NewsArticleDTO["quote"]) ?? undefined,
      author: (art.articleAuthor as NewsArticleDTO["author"]) ?? undefined,
      attachments,
      relatedSlugs,
    };
  }

  /**
   * Get related articles for a given slug
   */
  static async getRelatedArticles(slug: string, limit = 4): Promise<NewsArticleDTO[]> {
    const article = await prisma.newsArticle.findUnique({
      where: { slug },
      include: {
        relationsFrom: {
          orderBy: { sortOrder: "asc" },
          include: {
            relatedArticle: true,
          },
        },
      },
    });

    const relatedArticles: NewsArticleDTO[] = [];
    const usedSlugs = new Set<string>([slug]);

    if (article) {
      for (const rel of article.relationsFrom) {
        if (rel.relatedArticle.isPublished && !usedSlugs.has(rel.relatedArticle.slug)) {
          usedSlugs.add(rel.relatedArticle.slug);
          const ra = rel.relatedArticle;
          relatedArticles.push({
            id: ra.id,
            slug: ra.slug,
            tag: ra.tag,
            category: ra.category,
            title: ra.title,
            date: ra.dateDisplay,
            publishedAt: formatPublishedAt(ra.publishedAt, ra.dateDisplay),
            location: ra.location,
            image: ra.imageKey || "",
            imageCaption: ra.imageCaption ?? undefined,
            desc: ra.description,
            lead: ra.lead ?? undefined,
            body: (ra.body as string[]) || [],
            quote: (ra.quote as NewsArticleDTO["quote"]) ?? undefined,
            author: (ra.articleAuthor as NewsArticleDTO["author"]) ?? undefined,
          });
          if (relatedArticles.length >= limit) {
            break;
          }
        }
      }
    }

    // Fallback if fewer than limit: fetch recent published articles excluding used slugs
    if (relatedArticles.length < limit) {
      const remaining = limit - relatedArticles.length;
      const fallbacks = await prisma.newsArticle.findMany({
        where: {
          isPublished: true,
          slug: { notIn: Array.from(usedSlugs) },
        },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: remaining,
      });

      for (const fa of fallbacks) {
        relatedArticles.push({
          id: fa.id,
          slug: fa.slug,
          tag: fa.tag,
          category: fa.category,
          title: fa.title,
          date: fa.dateDisplay,
          publishedAt: formatPublishedAt(fa.publishedAt, fa.dateDisplay),
          location: fa.location,
          image: fa.imageKey || "",
          imageCaption: fa.imageCaption ?? undefined,
          desc: fa.description,
          lead: fa.lead ?? undefined,
          body: (fa.body as string[]) || [],
          quote: (fa.quote as NewsArticleDTO["quote"]) ?? undefined,
          author: (fa.articleAuthor as NewsArticleDTO["author"]) ?? undefined,
        });
      }
    }

    return relatedArticles;
  }
}

