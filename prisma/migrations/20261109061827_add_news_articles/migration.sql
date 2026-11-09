-- CreateTable
CREATE TABLE "news_articles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Press release',
    "title" TEXT NOT NULL,
    "date_display" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ,
    "location" TEXT NOT NULL DEFAULT '',
    "image_key" TEXT,
    "image_caption" TEXT,
    "description" TEXT NOT NULL,
    "lead" TEXT,
    "body" JSONB NOT NULL DEFAULT '[]',
    "quote" JSONB,
    "article_author" JSONB,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "article_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size_bytes" BIGINT,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "news_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_relations" (
    "article_id" UUID NOT NULL,
    "related_article_id" UUID NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "news_relations_pkey" PRIMARY KEY ("article_id","related_article_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "news_articles_slug_key" ON "news_articles"("slug");

-- CreateIndex
CREATE INDEX "idx_news_published" ON "news_articles"("published_at" DESC);

-- CreateIndex
CREATE INDEX "idx_news_slug" ON "news_articles"("slug");

-- AddForeignKey
ALTER TABLE "news_attachments" ADD CONSTRAINT "news_attachments_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "news_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_relations" ADD CONSTRAINT "news_relations_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "news_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_relations" ADD CONSTRAINT "news_relations_related_article_id_fkey" FOREIGN KEY ("related_article_id") REFERENCES "news_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
