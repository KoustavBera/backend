# Durgapur High School — Backend Design

> **Status:** Design only. No code has been written.
> **Last updated:** 2026-11-08 (rev 4 — concurrent auth grace window, strict CSRF origin verification, transactional R2 lifecycle, exact DTO mappings)
> **Project in one line:** A bilingual (English/Bengali) public school website for Durgapur High School, serving parents and students with news, faculty profiles, a gallery, an admissions enquiry form, and a Study Zone where teachers upload subject-specific resources (videos, PDFs, past papers) organised by class.

---

## Findings from frontend analysis

### 1. Pages / routes and their data

| Route | Data shown | Data submitted | Current source |
|---|---|---|---|
| `/` (Home) | School identity, announcements, programs, campus cards, testimonials, FAQs, news preview (3 articles), gallery preview (7 photos) | — | Static TS modules |
| `/news` | All news articles (title, tag, date, image, desc) with client-side category filter | — | `getAllNews()` mock seam |
| `/news/[slug]` | Full article (body, quote, author, attachments, related articles) | — | `getNewsBySlug()` + `getRelatedNews()` mock seam |
| `/faculty` | Faculty list (name, Bengali name, designation, education, photo) | — | Static TS module |
| `/gallery` | Full photo grid with category filter + lightbox | — | Static TS module |
| `/study-zone` | Class picker | — | Static class list |
| `/study-zone/[classId]` | Subject grid with resource count badge | — | `study-api.ts` (localStorage) |
| `/study-zone/[classId]/[subjectId]` | Resource grid filterable by category (video/notes/book/pyq) | Resource upload (PDF/image/YouTube link) | `study-api.ts` (localStorage) |
| `/#admissions` | FAQ accordion | Enquiry form (parent name, phone, email, class, message) | Form submits nowhere yet |

### 2. API calls / mock data to replace

| Frontend function | Intended backend endpoint | Notes |
|---|---|---|
| `getAllNews()` | `GET /api/news` | React `cache()` already wraps it |
| `getNewsBySlug(slug)` | `GET /api/news/:slug` | Returns `null` → 404 in page |
| `getRelatedNews(slug, limit)` | `GET /api/news/:slug/related?limit=4` | Ordered by `relatedSlugs` then fallback |
| `listSubjects(classId)` | `GET /api/study/classes/:classId/subjects` | Returns `SubjectSummary[]` with `resourceCount` |
| `getSubject(classId, subjectId)` | `GET /api/study/classes/:classId/subjects/:subjectId` | Null → 404 |
| `createSubject(input)` | `POST /api/study/classes/:classId/subjects` | Teacher/admin |
| `deleteSubject(classId, subjectId)` | `DELETE /api/study/classes/:classId/subjects/:subjectId` | Cascades resources |
| `listResources(classId, subjectId)` | `GET /api/study/classes/:classId/subjects/:subjectId/resources` | Public (published only) |
| `createResource(input)` | `POST /api/study/classes/:classId/subjects/:subjectId/resources` | Multipart for files; JSON for YouTube |
| `deleteResource(resourceId)` | `DELETE /api/study/resources/:resourceId` | Teacher/admin |
| Admissions form `onSubmit` | `POST /api/admissions/enquiries` | Currently fires nothing |

### 3. Auth / user-specific UI

- **Roles:** `visitor` (anonymous), `teacher`, `admin`
- **Teacher/admin** UI: "Teacher tools" toolbar → Add Subject dialog, Delete subject button, Upload material dialog, Delete resource button
- Currently faked by `localStorage` key `durg-mock-role` and toggled by `DevRoleSwitcher` (dev-only)
- No login screen exists yet — this must be added
- **Admin-only extras:** staff management, enquiry review, audit log inspection

### 4. Forms / uploads / special UI

- **Admissions enquiry form:** parent name (required), phone (required, pattern-validated), email (optional), class interest (select), message (textarea)
- **Subject upload:** YouTube URL (validated to 11-char video ID) OR file (PDF / image, max 10 MB in production)
- **Category filter tabs** on resources — client-side state, filterable by category and academic year
- No search, no real-time UI, no WebSockets

### 5. Response shape assumptions (frontend expects exactly these)

```ts
// SubjectSummary
{ id, classId, name, bn?, icon, tone, resourceCount }

// StudyResource
{ id, classId, subjectId, category, format, title, url, chapter?, uploadedAt, uploadedBy? }

// NewsArticle
{ id, slug, tag, category, title, date, publishedAt, location, image, imageCaption?,
  desc, lead?, body: string[], quote?, author?, attachments?, relatedSlugs? }
```

### My assumptions (filling gaps) — revised for production

> These replace the original oversimplifications. Rationale for each decision is inline.

1. **Auth: Access token (15 min) + rotating refresh token (7 days, 256-bit CSPRNG entropy stored as SHA-256 in DB).**
   Token rotation incorporates a **30-second concurrency grace window with `replaced_by_id` tracking**. When multiple browser tabs make simultaneous refresh requests as an access token expires, the server returns the existing active successor token idempotently instead of falsely detecting token theft and revoking the session. Reuse of a revoked token outside this 30-second grace window triggers full session family revocation.

2. **Teachers are scoped to the classes they are assigned to.**
   A single compromised teacher account must not be able to delete study material for all 12 classes. Each `user_class_assignment` row grants a teacher write access to one class. Admins retain site-wide write access. This adds one join but meaningfully limits damage from credential theft.

3. **File storage: Cloudflare R2 (private bucket, permanent object keys in DB).**
   The `object_key` is stored permanently in PostgreSQL. The server generates a fresh short-lived signed download URL (`GetObject`, 1-hour expiry) **on every resource read request** — signed URLs are never stored in the database. Upload verification is strictly two-tiered: S3 `HeadObject` validates metadata and content length; S3 `GetObject` with a byte-range request (`Range: bytes=0-15`) inspects magic-byte signatures without transferring the entire file. Upload intents are tracked in PostgreSQL with foreign keys and class-scoped authorization.

4. **The `tone` field is assigned cyclically by the server and not persisted as a user choice.**
   Purely cosmetic, calculated at runtime (`TONE_LIST[index % TONE_LIST.length]`), no database column needed.

5. **News, faculty, and gallery content live in the database.**
   Correct for a site whose content must be updatable without a code deploy.

6. **Rate limiting is Redis-backed (Upstash free tier) from day one, not in-memory.**
   Redis is used **strictly for rate limiting** (~600 commands/day out of the 10,000/day free limit). Fail-closed on login; fail-open on admissions. Public content caching is handled by Next.js Server Component ISR (`revalidate: 60`), keeping read traffic off Redis entirely.

7. **Hosting: Render Starter tier ($7/month) or Railway Hobby ($5/month), not free.**
   Free-tier cold starts (15–30 s after 15 min idle) are unacceptable for real users. Design target: 50–100 concurrent users during peak school events with target RSS memory < 250 MB on a 512 MB container. *Note: Actual memory footprints and concurrency thresholds are engineering targets that must be validated through load testing (k6/autocannon) in staging prior to production launch.*

---

## 1. Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| **Language** | TypeScript | Same as the frontend; AI tools generate it reliably; no context switching |
| **Framework** | **Hono** on Node.js | Tiny (~12 kB), fast, first-class TypeScript, easy to test, deploys anywhere Node runs. Standalone API server isolates backend concerns from Next.js server actions. |
| **Database** | PostgreSQL via **Neon** | Relational constraints for hierarchical data (class → subject → resource). **Use Neon's built-in PgBouncer pooler** (`?pgbouncer=true` on `DATABASE_URL`). Pool capped to `connection_limit=5` on 512 MB RAM container. |
| **ORM** | **Prisma** | Typed queries, auto-generated migrations, good AI code generation support. `DIRECT_URL` used for migrations. |
| **Auth** | **Email + bcrypt + short-lived JWT (access) + 256-bit rotating refresh token in DB** | No external auth service. Invite-only staff accounts. 15-min access token limits breach exposure; server-stored refresh tokens with 30s concurrency grace window enable real logout and multi-tab stability. |
| **Session store** | **PostgreSQL** (`refresh_tokens` table) | Refresh tokens stored, linked, and invalidated server-side. No Redis needed for session persistence. |
| **Rate limiting** | **Upstash Redis** (free tier: 10k commands/day) | In-memory limiters reset on deploy. Redis provides shared state across instances. Used strictly for rate limiting (~600 commands/day). |
| **File storage** | **Cloudflare R2** (private bucket) | Free tier (10 GB storage, zero egress). Server issues signed upload URLs; browser uploads directly. Server verifies metadata via `HeadObject` and binary magic bytes via byte-range `GetObject (0-15)` before persisting. |
| **Hosting** | **Render Starter ($7/mo) or Railway Hobby ($5/mo)** | Eliminates sleeping containers. 512 MB RAM container target with persistent connections. |
| **Validation** | **Zod** | Schema-first validation for all route bodies, query params, and env vars. |
| **Email** | **Resend** free tier (100 emails/day) | For admissions enquiry notifications and password-reset links. |
| **Security headers** | **Hono `secureHeaders()` middleware** | Sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`. |

---

## 2. Feature List

### MVP (Phase 1–4)

| Feature | Frontend component |
|---|---|
| Staff login (email + password) | New `/login` page (minimal) |
| Session refresh with 30s grace window | Background API client fetch / Next.js middleware |
| Password reset via email token | New `/forgot-password` and `/reset-password` views |
| Study Zone: list subjects per class | `SubjectGrid` → replaces `study-api.ts` localStorage |
| Study Zone: list resources per subject | `ResourceBrowser` → replaces `study-api.ts` localStorage |
| Study Zone: create/delete subject (teacher, class-scoped) | `AddSubjectDialog`, `DeleteSubjectDialog` |
| Study Zone: upload resource — YouTube link (teacher) | `UploadDialog` (video category) |
| Study Zone: upload resource — PDF/image with magic byte verification | `UploadDialog` (notes/book/pyq category) |
| Study Zone: draft/publish lifecycle | `ResourceBrowser` (new uploads default to draft) |
| Study Zone: delete resource (uploader or admin) | `ConfirmDialog` in `ResourceBrowser` (transactional R2 deletion queue) |
| News: list articles (Next.js ISR cached) | `NewsArchive` → replaces `getAllNews()` mock |
| News: get article by slug | `NewsDetail` → replaces `getNewsBySlug()` mock |
| News: get related articles | `NewsDetail` sidebar |
| Admissions enquiry form → store in DB + email notice | `Admissions.onSubmit` (PII sanitized in logs) |
| Health-check endpoints (`/api/health/live`, `/api/health/ready`) | Ops / Render/Railway health ping |

### Nice-to-haves (Phase 5+)

| Feature | Frontend component |
|---|---|
| Faculty CRUD (admin) | New admin panel; replaces static `faculty.ts` |
| Gallery image CRUD (admin) | New admin panel; replaces static `gallery.ts` |
| News article CRUD (admin) | New admin panel; replaces static `news.ts` |
| Admissions enquiry dashboard (admin) | New admin-only page (PII reveal action with audit logging) |
| Announcement CRUD (admin) | Replaces `ANNOUNCEMENTS` array in `site.ts` |
| Resource version history | Future enhancement |

---

## 3. Architecture

### Folder structure

```text
backend/
  src/
    index.ts                  Hono app + route registration
    config.ts                 env vars, validated with zod
    db/
      prisma.ts               Prisma client singleton (connection_limit=5)
      redis.ts                Upstash Redis client singleton (rate-limiting only)
    middleware/
      auth.ts                 Cookie verification (access + refresh); sets ctx.var.user
      rateLimit.ts            Upstash Redis sliding-window rate limiter (fail-closed auth, fail-open admissions)
      cors.ts                 CORS config + exact parsed-origin validation
    routes/
      auth.ts                 POST /api/auth/{login,refresh,logout,me,forgot-password,reset-password}
      study.ts                Study Zone routes
      news.ts                 News read routes
      admissions.ts           Enquiry submission
      health.ts               GET /api/health/live  GET /api/health/ready
    services/
      auth.service.ts         Password check, token sign/verify, grace-period rotation, lockout check
      study.service.ts        Business logic, DB queries, class-scope check
      news.service.ts         DB queries + DTO mapping
      admissions.service.ts   Validation + storage + Resend email dispatch (PII sanitization)
      storage.service.ts      R2 presigned upload URL + fresh download URL generation
      verify.service.ts       HeadObject metadata check + GetObject Range: bytes=0-15 magic byte validation
      cleanup.service.ts      Drains pending_deletions queue (exponential backoff) + purges expired intents
      audit.service.ts        Append-only audit log writes
    dtos/
      study.dto.ts            Public response shapes (match frontend types exactly)
      news.dto.ts
    lib/
      errors.ts               AppError class + HTTP status mapping
      slug.ts                 Slug generation (matches frontend logic)
      magic.ts                File magic-byte signature definitions (PDF, JPEG, PNG, WebP)
  prisma/
    schema.prisma
    migrations/
    seed.ts
  .env.example
  package.json
  tsconfig.json
```

### Request flow

```mermaid
flowchart LR
    B["Browser (Next.js client)"]
    N["Next.js Server Component"]
    H["Hono API Server
(Render Starter / Railway)"]
    P["Prisma ORM"]
    DB["Neon PostgreSQL"]
    REDIS["Upstash Redis
(rate limiting only)"]
    R2["Cloudflare R2
(private bucket)"]

    B -->|"fetch /api/..."| H
    N -->|"fetch /api/... (revalidate:60)"| H
    H <-->|"rate-limit check"| REDIS
    H -->|query| P
    P -->|SQL| DB
    H -->|"signed upload URL (1h)"| B
    B -->|"PUT file directly"| R2
    H -->|"1. HeadObject (metadata)
2. GetObject Range: bytes=0-15 (magic bytes)"| R2
    B -->|"POST finalize resource"| H
    H -->|"GetObject signed URL (1h)
generated fresh per request"| B
    H -->|"DeleteObject (via transactional pending_deletions queue)"| R2
```

### Design principle: Modular Monolith

One deployable Node.js process. Routes → Services → Prisma. No microservices or external message brokers. Background queue drainage runs on a lightweight in-process interval with transactional persistence in PostgreSQL.

---

## 4. Data Models

| Entity | Key fields | Notes |
|---|---|---|
| `User` | id (UUID), email, password_hash, display_name, is_active, failed_login_count, locked_until | Staff only; no public registration. `failed_login_count` and `locked_until` enable account lockout. |
| `UserRole` | user_id, role (`teacher`\|`admin`) | Many roles per user; unique `(user_id, role)` |
| `Class` | id (`class-1`..`class-12`), number, roman, label, board, sort_order | Seeded; never created by API. Defined before dependent tables in DDL. |
| `UserClassAssignment` | user_id (FK), class_id (FK) | Teachers are scoped to only the classes listed here. Admins bypass this table entirely. |
| `RefreshToken` | id (UUID), user_id (FK), token_hash (TEXT UNIQUE), family_id (UUID), replaced_by_id (UUID? FK), expires_at, revoked_at?, created_at | 256-bit CSPRNG token (base64url). 30-sec grace window with `replaced_by_id` handles concurrent tab refreshes. Reuse outside grace revokes `family_id`. |
| `PasswordResetToken` | id (UUID), user_id (FK), token_hash (TEXT UNIQUE), expires_at, used_at?, created_at | Dedicated table. 256-bit token; 1-hour expiry; single-use. Re-requesting invalidates prior active tokens. |
| `LoginAttempt` | id (UUID), email (TEXT), ip (TEXT), attempted_at, succeeded (BOOLEAN) | Append-only audit log for IP rate limiting and lockout diagnostics. Purged after 30 days. |
| `Subject` | id (UUID), class_id (FK), slug (TEXT), name (CITEXT), name_bn?, icon, is_active, created_by (FK), timestamps | `name` uses `CITEXT` extension for case-insensitive uniqueness per class. Subjects are persistent curriculum entities. |
| `Resource` | id (UUID), subject_id (FK ON DELETE CASCADE), category, format, title, chapter?, object_key?, youtube_url?, uploaded_by (FK), uploaded_at, is_published, academic_year | `is_published DEFAULT FALSE` (draft by default). `academic_year` validated with regex `^[0-9]{4}-[0-9]{2}$`. Object key is permanent; signed download URLs generated on demand. |
| `UploadIntent` | id (UUID), user_id (FK ON DELETE CASCADE), subject_id (FK ON DELETE CASCADE), object_key (TEXT UNIQUE), content_type, size_bytes, expires_at, finalized_at?, created_at | Tracks pre-signed upload URLs. Verified against teacher's class scope. Cascades if subject or user is deleted. |
| `PendingDeletion` | id (UUID), object_key (TEXT), status (ENUM), attempt_count, max_attempts, next_attempt_at, last_error?, created_at, updated_at | Transactionally inserted whenever files are deleted in DB. Drained via exponential backoff; dead-letter alerting after 5 attempts. |
| `AuditLog` | id (UUID), user_id (FK?), action (TEXT), entity_type, entity_id?, metadata (JSONB), ip?, created_at | Append-only. Records auth events, resource upload/deletion/publishing, teacher assignments, and enquiry status updates. |
| `NewsArticle` | id (UUID), slug (unique), tag, category, title, date_display, published_at, location, image_key, image_caption?, description, lead?, body (JSONB), quote (JSONB?), article_author (JSONB?), is_published, timestamps | Public articles. Cached at edge via Next.js ISR (`revalidate: 60`). |
| `NewsAttachment` | id (UUID), article_id (FK ON DELETE CASCADE), object_key, title, type, size_bytes, sort_order | Attachments served via fresh signed URLs. |
| `NewsRelation` | article_id (FK), related_article_id (FK), sort_order | Unique pair. Maps related articles. |
| `AdmissionEnquiry` | id (UUID), parent_name, phone, email?, class_interest?, message?, status, submitted_at, reviewed_by (FK?), reviewed_at?, purge_after | Parent PII. Strict log sanitization. `purge_after = submitted_at + 2 years`. Auto-purged when closed; review alert if unread. |
| `GalleryItem` | id (UUID), object_key, caption?, category, sort_order, is_published | Phase 5 |
| `Faculty` | id (UUID), slug, name, name_bn?, designation, designation_bn?, education, education_bn?, image_key, sort_order, is_active | Phase 5 |

---

### DTO & Database Schema Mapping Reference

To prevent runtime mismatches between the PostgreSQL schema and existing frontend TypeScript interfaces, the service layer applies the following explicit transformations:

#### 1. `SubjectSummary` / `Subject` DTO Mapping

| Database Column (`subjects`) | Frontend Field (`SubjectSummary`) | Transformation / Logic |
|---|---|---|
| `slug` | `id` | **Frontend uses slug as `id`** in URL paths (`/study-zone/[classId]/[subjectId]`) |
| `class_id` | `classId` | Direct string assignment (e.g. `'class-10'`) |
| `name` | `name` | String |
| `name_bn` | `bn` | Mapped to `bn?: string` (omitted if `NULL`) |
| `icon` | `icon` | String matching Lucide icon identifier |
| *(computed at runtime)* | `tone` | Cyclically assigned: `TONE_LIST[index % TONE_LIST.length]` |
| *(computed via SQL)* | `resourceCount` | `COUNT(r.id) FILTER (WHERE r.is_published = TRUE)` |

#### 2. `StudyResource` DTO Mapping

| Database Column (`resources`) | Frontend Field (`StudyResource`) | Transformation / Logic |
|---|---|---|
| `id` | `id` | UUID string |
| *(from parent `subjects.class_id`)*| `classId` | Joined from parent `subjects` table |
| `subject_id` | `subjectId` | Joined parent subject `slug` (matches frontend URL slug) |
| `category` | `category` | Enum: `'video' \| 'notes' \| 'book' \| 'pyq'` |
| `format` | `format` | Enum: `'youtube' \| 'pdf' \| 'image'` |
| `title` | `title` | String (1–200 chars) |
| `youtube_url` / `object_key` | `url` | If `format === 'youtube'`, returns `youtube_url`. If file, returns **freshly generated signed R2 `GetObject` URL** (1-hour expiry). |
| `chapter` | `chapter` | Optional string (omitted if `NULL`) |
| `uploaded_at` | `uploadedAt` | `uploaded_at.toISOString()` |
| *(from `users.display_name`)* | `uploadedBy` | Joined from `users` table via `uploaded_by` (omitted if `NULL`) |
| `academic_year` | *(query filter)* | Filterable via `?year=2025-26` |
| `is_published` | *(access control)* | Public reads return only `is_published = true`. Teachers see own drafts via `/drafts` route. |

#### 3. `NewsArticle` DTO Mapping

| Database Column (`news_articles`) | Frontend Field (`NewsArticle`) | Transformation / Logic |
|---|---|---|
| `id` | `id` | UUID string |
| `slug` | `slug` | Unique slug |
| `tag` | `tag` | String |
| `category` | `category` | String |
| `title` | `title` | String |
| `date_display` | `date` | Display date string (e.g. `'30 Sep 2026'`) |
| `published_at` | `publishedAt` | `published_at.toISOString()` |
| `location` | `location` | String |
| `image_key` | `image` | Signed URL or public CDN URL for thumbnail |
| `image_caption` | `imageCaption` | Optional string |
| `description` | `desc` | Excerpt string |
| `lead` | `lead` | Optional dateline lead string |
| `body` | `body` | `JSONB` array of string paragraphs (`string[]`) |
| `quote` | `quote` | `JSONB` `{ text, author, role }` |
| `article_author` | `author` | `JSONB` `{ name, role, email? }` |
| *(joined `news_attachments`)* | `attachments` | Mapped array: `{ id, title, type, size: formatBytes(size_bytes), url: getSignedUrl(object_key) }` |
| *(joined `news_relations`)* | `relatedSlugs` | Array of related article slug strings (`string[]`) |

---

## 5. Database Schema (DDL)

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";      -- case-insensitive text type for subject names

-- ── Enums ─────────────────────────────────────────────────────────────────────
CREATE TYPE user_role_enum   AS ENUM ('teacher', 'admin');
CREATE TYPE resource_category AS ENUM ('video', 'notes', 'book', 'pyq');
CREATE TYPE resource_format   AS ENUM ('youtube', 'pdf', 'image');
CREATE TYPE deletion_status   AS ENUM ('pending', 'processing', 'completed', 'failed');

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT NOT NULL UNIQUE,
  password_hash      TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_count SMALLINT NOT NULL DEFAULT 0,
  locked_until       TIMESTAMPTZ,              -- NULL = not locked; set if failed_login_count >= 10
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    user_role_enum NOT NULL,
  PRIMARY KEY (user_id, role)
);

-- ── Classes (seed data) ───────────────────────────────────────────────────────
-- Defined BEFORE user_class_assignments and subjects so FKs resolve.
CREATE TABLE classes (
  id         TEXT PRIMARY KEY,            -- e.g. 'class-1'
  number     SMALLINT NOT NULL UNIQUE,
  roman      TEXT NOT NULL,
  label      TEXT NOT NULL,
  board      TEXT NOT NULL,
  sort_order SMALLINT NOT NULL
);

-- ── Teacher → class scope ─────────────────────────────────────────────────────
CREATE TABLE user_class_assignments (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, class_id)
);

-- ── Rotating refresh tokens ───────────────────────────────────────────────────
-- family_id tracks the session tree. replaced_by_id points to the successor token.
-- 30-second grace window allows concurrent tab refreshes without family revocation.
CREATE TABLE refresh_tokens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,     -- SHA-256 of 256-bit CSPRNG token string
  family_id      UUID NOT NULL,            -- groups rotations originating from one login
  replaced_by_id UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,              -- NULL = active; TIMESTAMPTZ = rotated / revoked
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user     ON refresh_tokens(user_id, expires_at);
CREATE INDEX idx_refresh_tokens_family   ON refresh_tokens(family_id);
CREATE INDEX idx_refresh_tokens_hash_rev ON refresh_tokens(token_hash, revoked_at);

-- ── Password reset tokens ────────────────────────────────────────────────────
CREATE TABLE password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,     -- SHA-256 of 256-bit CSPRNG token string
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,              -- NULL = active; TIMESTAMPTZ = consumed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prt_user ON password_reset_tokens(user_id, expires_at);

-- ── Login audit log ───────────────────────────────────────────────────────────
-- Used for IP-level rate limiting and brute force analysis. Purged after 30 days.
CREATE TABLE login_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  ip           TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  succeeded    BOOLEAN NOT NULL
);

CREATE INDEX idx_login_attempts_email_time ON login_attempts(email, attempted_at DESC);
CREATE INDEX idx_login_attempts_ip_time    ON login_attempts(ip, attempted_at DESC);

-- ── Study Zone ────────────────────────────────────────────────────────────────
CREATE TABLE subjects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    TEXT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  slug        TEXT NOT NULL,
  name        CITEXT NOT NULL,         -- CITEXT enforces case-insensitive uniqueness per class
  name_bn     TEXT,
  icon        TEXT NOT NULL DEFAULT 'book',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_subject_class_slug UNIQUE (class_id, slug),
  CONSTRAINT uq_subject_class_name UNIQUE (class_id, name)
);

CREATE INDEX idx_subjects_class_id ON subjects(class_id) WHERE is_active = TRUE;

CREATE TABLE resources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id    UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  category      resource_category NOT NULL,
  format        resource_format NOT NULL,
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  chapter       TEXT CHECK (char_length(chapter) <= 60),
  object_key    TEXT,                    -- R2 key (permanent); NULL for YouTube
  youtube_url   TEXT,                    -- YouTube watch URL; NULL for files
  uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_published  BOOLEAN NOT NULL DEFAULT FALSE,  -- draft by default
  academic_year TEXT NOT NULL CHECK (academic_year ~ '^[0-9]{4}-[0-9]{2}$'), -- e.g. '2025-26'
  CONSTRAINT chk_resource_source CHECK (
    (format = 'youtube' AND youtube_url IS NOT NULL AND object_key IS NULL) OR
    (format != 'youtube' AND object_key IS NOT NULL AND youtube_url IS NULL)
  )
);

CREATE INDEX idx_resources_subject ON resources(subject_id) WHERE is_published = TRUE;
CREATE INDEX idx_resources_year    ON resources(subject_id, academic_year) WHERE is_published = TRUE;
CREATE INDEX idx_resources_draft   ON resources(subject_id, uploaded_by) WHERE is_published = FALSE;

-- ── Upload intent tracking ────────────────────────────────────────────────────
-- Foreign key to subjects(id) with CASCADE. Authorization checked against class assignment.
CREATE TABLE upload_intents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  object_key   TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,     -- 1-hour upload window
  finalized_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_upload_intents_expires ON upload_intents(expires_at)
  WHERE finalized_at IS NULL;

-- ── R2 deletion queue ─────────────────────────────────────────────────────────
-- Transactionally inserted whenever files are deleted from database.
CREATE TABLE pending_deletions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key      TEXT NOT NULL,
  status          deletion_status NOT NULL DEFAULT 'pending',
  attempt_count   SMALLINT NOT NULL DEFAULT 0,
  max_attempts    SMALLINT NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pending_deletions_queue ON pending_deletions(status, next_attempt_at)
  WHERE status IN ('pending', 'failed') AND attempt_count < max_attempts;

-- ── Audit log ─────────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  metadata    JSONB,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_user   ON audit_logs(user_id, created_at DESC);

-- ── News ──────────────────────────────────────────────────────────────────────
CREATE TABLE news_articles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT NOT NULL UNIQUE,
  tag            TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'Press release',
  title          TEXT NOT NULL,
  date_display   TEXT NOT NULL,
  published_at   TIMESTAMPTZ,
  location       TEXT NOT NULL DEFAULT '',
  image_key      TEXT,
  image_caption  TEXT,
  description    TEXT NOT NULL,
  lead           TEXT,
  body           JSONB NOT NULL DEFAULT '[]',
  quote          JSONB,
  article_author JSONB,
  is_published   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_news_published ON news_articles(published_at DESC) WHERE is_published = TRUE;
CREATE INDEX idx_news_slug      ON news_articles(slug);

CREATE TABLE news_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  UUID NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
  object_key  TEXT NOT NULL,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('pdf','zip','doc','image')),
  size_bytes  BIGINT,
  sort_order  SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE news_relations (
  article_id         UUID NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
  related_article_id UUID NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
  sort_order         SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, related_article_id),
  CONSTRAINT chk_no_self_relation CHECK (article_id != related_article_id)
);

-- ── Admissions ───────────────────────────────────────────────────────────────
CREATE TABLE admission_enquiries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_name    TEXT NOT NULL CHECK (char_length(parent_name) BETWEEN 2 AND 100),
  phone          TEXT NOT NULL CHECK (phone ~ '^[0-9+\s\-]{10,15}$'),
  email          TEXT CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
  class_interest TEXT,
  message        TEXT CHECK (char_length(message) <= 1000),
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','replied','closed')),
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  purge_after    TIMESTAMPTZ NOT NULL GENERATED ALWAYS AS
                   (submitted_at + INTERVAL '2 years') STORED
);

CREATE INDEX idx_enquiries_submitted ON admission_enquiries(submitted_at DESC);
CREATE INDEX idx_enquiries_purge     ON admission_enquiries(purge_after)
  WHERE status IN ('closed', 'replied');

-- ── Migration strategy ────────────────────────────────────────────────────────
-- Use Prisma Migrate for all schema changes.
-- `prisma migrate deploy` runs as a pre-start step in production.
-- Never use `prisma db push` on staging/production.
-- Seed: npx ts-node prisma/seed.ts (idempotent; seeds classes, one admin, sample teachers).
```

---

## 6. REST API Spec

### Standard response envelope

```jsonc
// Success
{ "data": { ... } }          // or "data": [ ... ]

// Error
{ "error": { "code": "VALIDATION_ERROR", "message": "human readable" } }
```

### Auth

| Method | Path | Auth | Request body | Response | Errors |
|---|---|---|---|---|---|
| `POST` | `/api/auth/login` | None | `{email, password}` | `{data:{user:{id,email,displayName,roles[]}}}` + sets `durg_access` cookie (15 min) + `durg_refresh` cookie (7 days) | 401, 423 (locked), 429 (IP limit) |
| `POST` | `/api/auth/refresh` | `durg_refresh` cookie | — | `{data:{ok:true}}` + rotates or idempotently returns active token pair | 401 (invalid/stolen) |
| `POST` | `/api/auth/logout` | `durg_access` cookie | — | `{data:{ok:true}}` + clears cookies + revokes `durg_refresh` | 401 |
| `GET` | `/api/auth/me` | `durg_access` cookie | — | `{data:{user:{id,email,displayName,roles[],classes[]}}}` | 401 |
| `POST` | `/api/auth/forgot-password` | None | `{email}` | `{data:{ok:true}}` (always returns 200 to prevent enumeration) | 429 |
| `POST` | `/api/auth/reset-password` | None | `{token, newPassword}` | `{data:{ok:true}}` + revokes all refresh tokens for user | 400 (expired/used), 429 |

> **Cookie configuration:** `durg_access` has `Path=/; HttpOnly; Secure; SameSite=Strict`. `durg_refresh` has `Path=/api/auth; HttpOnly; Secure; SameSite=Strict`.

### Study Zone

| Method | Path | Auth | Query / Request | Response `data` | Errors |
|---|---|---|---|---|---|
| `GET` | `/api/study/classes/:classId/subjects` | Public | — | `SubjectSummary[]` (published only) | 404 |
| `GET` | `/api/study/classes/:classId/subjects/:subjectId` | Public | — | `Subject` | 404 |
| `POST` | `/api/study/classes/:classId/subjects` | Teacher/Admin | `{name, name_bn?, icon}` | `Subject` | 400, 401, 403 (unassigned), 409 |
| `DELETE` | `/api/study/classes/:classId/subjects/:subjectId` | Teacher/Admin | — | `{ok:true}` | 401, 403, 404 |
| `GET` | `/api/study/classes/:classId/subjects/:subjectId/resources` | Public | `?year=2025-26` | `StudyResource[]` (published only) | 404 |
| `GET` | `/api/study/classes/:classId/subjects/:subjectId/resources/drafts` | Teacher/Admin | — | `StudyResource[]` (uploader's own drafts) | 401, 403, 404 |
| `POST` | `/api/study/upload-url` | Teacher/Admin | `{subjectId, filename, contentType, bytes}` | `{uploadUrl, objectKey, intentId, expiresAt}` | 400, 401, 403 (unassigned), 413 |
| `POST` | `/api/study/classes/:classId/subjects/:subjectId/resources` | Teacher/Admin | `{category, format, title, chapter?, intentId?, youtube_url?, academic_year}` | `StudyResource` (draft) | 400, 401, 403 |
| `PATCH` | `/api/study/resources/:resourceId/publish` | Teacher/Admin | — | `{ok:true}` | 401, 403, 404 |
| `DELETE` | `/api/study/resources/:resourceId` | Teacher/Admin | — | `{ok:true}` | 401, 403 (not uploader/admin), 404 |

### News (read-only initially)

| Method | Path | Auth | Response `data` | Cache headers |
|---|---|---|---|---|
| `GET` | `/api/news` | Public | `NewsArticle[]` (published, newest first) | `public, s-maxage=60, stale-while-revalidate=30` |
| `GET` | `/api/news/:slug` | Public | `NewsArticle` | `public, s-maxage=60, stale-while-revalidate=30` |
| `GET` | `/api/news/:slug/related` | Public | `NewsArticle[]` (up to 4) | `public, s-maxage=60, stale-while-revalidate=30` |

### Admissions

| Method | Path | Auth | Request body | Response | Errors |
|---|---|---|---|---|---|
| `POST` | `/api/admissions/enquiries` | Public | `{parentName, phone, email?, classInterest?, message?}` | `{data:{ok:true}}` | 400, 429 |

### Health

| Method | Path | Auth | Behaviour | Response |
|---|---|---|---|---|
| `GET` | `/api/health/live` | Public | Process liveness only. No external DB calls. | 200 `{status:"ok"}` |
| `GET` | `/api/health/ready` | Public | Readiness check for DB and Redis. Used by deployment probes. | 200 `{db:"ok", redis:"ok", uptime}`<br>200 `{db:"ok", redis:"degraded"}` (Redis outage degrades rate-limiting without killing container)<br>503 `{db:"error"}` (Database unreachable) |

> **Register `/api/health/live` as the Render/Railway liveness probe.** A transient Redis timeout will never trigger container crash-restart loops.

---

## 7. Auth and Security

### Authentication — Access Token & Refresh Token Rotation

Staff authenticate with email and bcrypt-hashed password. On success, the server issues two HTTP-only cookies:

| Cookie | Lifetime | Scope / Path | Contents / Generation |
|---|---|---|---|
| `durg_access` | 15 min | `/` | Signed JWT (`HS256`) containing `{sub, roles[], iat, exp}` |
| `durg_refresh` | 7 days | `/api/auth` | 256-bit CSPRNG token (`crypto.randomBytes(32).toString('base64url')`), stored as SHA-256 hash in DB |

#### Concurrency-Safe Token Rotation Algorithm

To prevent legitimate multi-tab races from triggering token reuse detection, rotation implements a **30-second concurrency grace window**:

```mermaid
sequenceDiagram
    autonumber
    actor Browser as Browser (Tabs 1 & 2)
    participant API as Hono Auth Route
    participant DB as Neon PostgreSQL

    Note over Browser,API: Access token expires; both tabs refresh concurrently with Token A
    Browser->>API: Tab 1: POST /api/auth/refresh (Token A)
    API->>DB: BEGIN TX: Check Token A (active)
    API->>DB: Insert Token B (family_id = F)<br/>Update Token A: revoked_at = NOW(), replaced_by_id = B.id
    API->>DB: COMMIT TX
    API-->>Browser: Set-Cookie: durg_access, durg_refresh (Token B)

    Browser->>API: Tab 2: POST /api/auth/refresh (Token A arriving 20ms later)
    API->>DB: Query Token A: revoked_at IS NOT NULL
    alt NOW() - revoked_at < 30 seconds (Grace Window)
        API->>DB: Fetch successor Token B via replaced_by_id
        Note over API: Successor active & valid → Idempotent success
        API-->>Browser: Set-Cookie: durg_access, durg_refresh (Token B)
    else NOW() - revoked_at >= 30 seconds (Reuse Attack)
        API->>DB: Security Breach: Revoke ALL tokens where family_id = F
        API->>DB: Insert AuditLog ('auth.refresh_token_reuse_detected')
        API-->>Browser: 401 Unauthorized (Clear Cookies)
    end
```

**Step-by-Step Logic:**
1. Incoming `durg_refresh` cookie is hashed with SHA-256 and looked up in `refresh_tokens`.
2. **If active (`revoked_at IS NULL`):**
   - Generate cryptographically secure Token B (256-bit entropy via `base64url`).
   - In a single transaction:
     - Insert Token B with identical `family_id`.
     - Update Token A: `revoked_at = NOW()`, `replaced_by_id = Token B.id`.
   - Issue new `durg_access` JWT and `durg_refresh` cookie.
3. **If revoked (`revoked_at IS NOT NULL`):**
   - **Check Concurrency Grace Period:** Is `NOW() - revoked_at < INTERVAL '30 seconds'` and `replaced_by_id IS NOT NULL`?
     - **YES (Concurrent Tab Race):** Fetch the successor token record (`replaced_by_id`). If it is still valid and unrevoked, return an idempotent 200 response with a fresh access JWT and the existing successor refresh token. Do *not* revoke the family.
     - **NO (Token Reuse Attack):** An old token is being replayed outside the grace window. Immediately execute:
       `UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = $family_id`.
       Insert security alert in `audit_logs` (`auth.refresh_token_reuse_detected`), clear cookies, and return 401 Unauthorized.

### Account Lockout — Two-Tier Strategy

To eliminate contradictions and avoid attacker-provoked denial-of-service on teacher accounts, lockout is split into two distinct tiers:

1. **Tier 1 — IP-level Rate Limiting (Brute-Force & Denial-of-Service Defense):**
   - Tracked in Upstash Redis via sliding window (fallback to `login_attempts` query if Redis is unreachable).
   - **5 failed login attempts within 15 minutes from the same IP** blocks further login attempts *from that IP* for 15 minutes (HTTP 429 Too Many Requests).
   - **Crucial:** This does *not* lock the teacher's account. The teacher can still authenticate from another network (e.g. mobile data, school Wi-Fi).

2. **Tier 2 — Account-level Lockout (Distributed Credential Stuffing Defense):**
   - Tracked directly on `users`: `failed_login_count` and `locked_until`.
   - If an account experiences **10 failed login attempts across any IP addresses** within a rolling window without an intervening successful login:
     - Set `users.locked_until = NOW() + INTERVAL '30 minutes'`.
     - Record `audit_logs` entry (`auth.account_locked`).
     - Return HTTP 423 (Locked) with header `Retry-After: 1800`.
   - **Reset:** A successful password check resets `failed_login_count = 0` and `locked_until = NULL`.
   - **Manual Override:** Admin can unlock accounts at any time via the admin dashboard (resets `locked_until = NULL, failed_login_count = 0`).

### CSRF Protection & Exact Origin Validation

Cookies use `SameSite=Strict`. Since the frontend and API share the registered apex domain (`durgapurhighschool.in`), modern browsers prevent cross-site request forgery.

**Defence-in-depth — Exact Origin Validation:**
For all state-changing HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`), middleware validates request headers:

```ts
const method = c.req.method;
if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
  const originHeader = c.req.header('Origin');
  const refererHeader = c.req.header('Referer');

  let requestOrigin: string | null = null;
  if (originHeader) {
    try {
      requestOrigin = new URL(originHeader).origin;
    } catch {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Malformed Origin header' } }, 400);
    }
  } else if (refererHeader) {
    try {
      requestOrigin = new URL(refererHeader).origin;
    } catch {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Malformed Referer header' } }, 400);
    }
  }

  // Safe policy for missing Origin/Referer on mutation requests:
  if (!requestOrigin) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Missing Origin and Referer on state-changing request' } }, 403);
  }

  // Exact origin equality (prevents startsWith prefix vulnerabilities)
  const allowedOrigin = new URL(config.FRONTEND_URL).origin;
  if (requestOrigin !== allowedOrigin) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Untrusted request origin' } }, 403);
  }
}
```

### Password Reset Flow

1. `POST /api/auth/forgot-password`:
   - Looks up user. If user exists, generates 256-bit CSPRNG token (`crypto.randomBytes(32).toString('base64url')`).
   - Invalidates any prior active reset tokens for this user (`DELETE FROM password_reset_tokens WHERE user_id = $id AND used_at IS NULL`).
   - Inserts SHA-256 hash into `password_reset_tokens` with `expires_at = NOW() + INTERVAL '1 hour'`.
   - Sends email via Resend with link: `https://durgapurhighschool.in/reset-password?token=...`.
   - Always returns `{data:{ok:true}}` to prevent account enumeration.
2. `POST /api/auth/reset-password`:
   - Hashes provided token with SHA-256.
   - Verifies record exists, `used_at IS NULL`, and `NOW() < expires_at`.
   - Hashes new password with bcrypt (`cost=12`).
   - In a transaction: updates `users.password_hash`, sets `password_reset_tokens.used_at = NOW()`, resets `failed_login_count = 0, locked_until = NULL`, and revokes all active refresh tokens for the user.

### File Upload Safety & Two-Tier R2 Verification

#### 1. Upload Intent Lifecycle & Authorization
- Before any file touches R2, the teacher calls `POST /api/study/upload-url` with `{subjectId, filename, contentType, bytes}`.
- Server validates that `subjectId` exists, resolves `subjects.class_id`, and verifies that the calling teacher is assigned to that class via `user_class_assignments` (admins bypass).
- Server inserts an `upload_intents` row (`subject_id REFERENCES subjects(id) ON DELETE CASCADE`) and returns a presigned S3 `PutObject` URL valid for 1 hour.

#### 2. Two-Tier Verification on Finalize
When the client calls `POST /resources` to finalize the upload:
- **Tier 1 — HTTP Metadata Check (`HeadObject`):** The server issues an S3 `HeadObjectCommand` to R2. Verifies that the object exists, `Content-Length` matches expected size (<= 10 MB), and declared MIME type is in `['application/pdf','image/jpeg','image/png','image/webp']`.
- **Tier 2 — Magic-Byte Signature Verification (`GetObject Range: bytes=0-15`):** `HeadObject` does *not* read file contents. The server executes an S3 `GetObjectCommand` requesting only the first 16 bytes:
  ```ts
  const rangeRes = await s3.send(new GetObjectCommand({
    Bucket: config.R2_BUCKET,
    Key: intent.object_key,
    Range: 'bytes=0-15'
  }));
  const bytes = await streamToBuffer(rangeRes.Body);
  validateMagicBytes(bytes, intent.content_type);
  ```
  Magic signatures checked:
  - PDF: `%PDF-` (`0x25 0x50 0x44 0x46 0x2D`)
  - JPEG: `0xFF 0xD8 0xFF`
  - PNG: `0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A`
  - WebP: `RIFF....WEBP` (`0x52 0x49 0x46 0x46 ... 0x57 0x45 0x42 0x50`)
- If validation fails: object is immediately deleted from R2, intent is marked invalid, and HTTP 400 is returned.
- On success: `upload_intents.finalized_at = NOW()`, `resources` record created with `is_published = false` (draft).

#### 3. Transactional R2 Deletion Queue & Orphan Reconciliation
- When any resource, subject, news attachment, or gallery item is deleted from PostgreSQL, the database deletion and the insertion into `pending_deletions` **must occur in the exact same database transaction**:
  ```ts
  await prisma.$transaction([
    prisma.resource.delete({ where: { id: resourceId } }),
    prisma.pendingDeletion.create({ data: { objectKey: resource.objectKey, status: 'pending' } })
  ]);
  ```
- **Worker Execution (`cleanup.service.ts`):** Runs every 10 minutes. Selects pending deletions where `status IN ('pending', 'failed') AND next_attempt_at <= NOW() AND attempt_count < max_attempts`.
- **Exponential Backoff:** If `s3.deleteObject` fails, worker increments `attempt_count`, sets `next_attempt_at = NOW() + (POWER(2, attempt_count) * INTERVAL '1 minute')` (1m, 2m, 4m, 8m, 16m), and logs error.
- **Dead-Letter Monitoring:** If `attempt_count >= max_attempts` (5), status becomes `'failed'`, and an alert is recorded in `audit_logs` (`system.r2_deletion_permanent_failure`).
- **Orphan Reconciliation:** A weekly background task lists R2 objects under `/uploads/` and cross-references active records in `resources`, `news_attachments`, `gallery_items`, and active `upload_intents`. Keys older than 7 days not referenced in the database are enqueued into `pending_deletions`.

### Privacy and Data Retention (Admission Enquiries)

1. **Access Control:** Restricted strictly to `admin` role. Teachers cannot read enquiries.
2. **Log Sanitization:** `parent_name`, `phone`, `email`, and `message` are **never written to application logs**. Only enquiry UUIDs and status changes are logged.
3. **Automated Data Purge:**
   - Enquiries contain a stored generated column: `purge_after TIMESTAMPTZ GENERATED ALWAYS AS (submitted_at + INTERVAL '2 years') STORED`.
   - A weekly automated maintenance job hard-deletes records where `purge_after < NOW() AND status IN ('closed', 'replied')`.
   - For unresolved enquiries (`new`, `read`) reaching `purge_after`, the system logs a high-priority audit event (`admissions.retention_warning`) requiring admin review before automated purge after 30 days.

---

## 8. Optimisation

### Indexing (already in DDL)
- `idx_subjects_class_id` — covers subject listings per class
- `idx_resources_subject` & `idx_resources_year` — covers published resource lookups and academic year filtering
- `idx_resources_draft` — fast lookup for teacher draft materials
- `idx_news_published` & `idx_news_slug` — covers news archive and detail queries
- `idx_refresh_tokens_hash_rev` & `idx_refresh_tokens_family` — covers rotation, grace-period lookup, and family revocation
- `idx_login_attempts_email_time` & `idx_login_attempts_ip_time` — covers lockout checks
- `idx_upload_intents_expires` — fast scan for abandoned uploads
- `idx_pending_deletions_queue` — drains deletion queue efficiently
- `idx_audit_entity` & `idx_audit_user` — audit trail queries
- `idx_enquiries_purge` — privacy retention cleanup

### Avoiding N+1 Queries
- `listSubjects` returns `resourceCount` via a single aggregated query:
  ```sql
  SELECT s.*, COUNT(r.id) FILTER (WHERE r.is_published = TRUE) AS resource_count
  FROM subjects s
  LEFT JOIN resources r ON r.subject_id = s.id
  WHERE s.class_id = $1 AND s.is_active = TRUE
  GROUP BY s.id
  ```
- Related news articles fetched in a single query: `WHERE slug = ANY($1::text[])`.

### Caching Architecture (Rationalised & Simplified)

1. **Next.js Server-Side Caching (Primary):** Next.js Server Components fetch news using `fetch('/api/news', { next: { revalidate: 60 } })`. Next.js caches rendered output at the edge for 60 seconds.
2. **HTTP Cache Headers:** Hono API sends `Cache-Control: public, s-maxage=60, stale-while-revalidate=30` on public news endpoints.
3. **No Redis Content Caching:** Upstash Redis is reserved **exclusively for rate limiting**. This avoids dual-cache invalidation complexity and preserves 94% of free Redis quota (~600 commands/day used vs. 10,000 limit).
4. **Study Zone Bypasses Cache:** Study resources and subjects use `Cache-Control: no-store` so teacher uploads and edits reflect immediately.

### Database Connection Pooling & Concurrency Budget

- Neon's built-in PgBouncer pooler enabled via `?pgbouncer=true` on `DATABASE_URL`.
- Prisma configured with `connection_limit=5` in `datasource` config to prevent thread and memory starvation.
- `DIRECT_URL` (non-pooled) reserved exclusively for `prisma migrate deploy`.

### Engineering Targets & Performance Benchmarks

- **Target Container RAM Budget:** RSS memory target < 250 MB on a 512 MB host during regular operations.
- **Concurrency Target:** 50–100 active concurrent users during high-traffic school events (e.g. board examination result announcements).
- **Mandatory Pre-Production Verification:** These performance figures are design targets. Prior to production launch, automated load tests using **k6** or **autocannon** must be executed against the staging environment to verify garbage collection stability, event-loop latency, and connection pool behavior under sustained concurrent load.

---

## 9. Extra Features Worth Adding

Ranked by value-to-effort ratio:

| # | Feature | Why | Effort |
|---|---|---|---|
| 1 | **Admin news editor** | Headmaster can publish news without a developer; highest user value | Medium — CRUD endpoints + simple form UI |
| 2 | **Admissions enquiry dashboard** (admin-only) | Staff can review, reply, and close enquiries with audit logging | Small — read-only table with status toggle |
| 3 | **Announcement CRUD** | Scrolling alert bar is static; school needs to update it regularly | Small — 1 table, 1 endpoint, 1 admin form |
| 4 | **Faculty CRUD** | Staff joins/leaves currently require developer intervention | Small — same CRUD pattern as news |
| 5 | **Enquiry email acknowledgement** | Parents get instant confirmation (Resend free tier: 100/day) | Small — `resend.emails.send()` after DB insert |

---

## 10. Dev and Ops

### Local setup

```bash
# 1. Clone, install
cd backend && bun install # or npm install

# 2. Copy env
cp .env.example .env
# Fill: DATABASE_URL, DIRECT_URL, ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET,
#       UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN,
#       R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, FRONTEND_URL,
#       BACKUP_ENCRYPTION_KEY

# 3. Migrate + seed (requires DATABASE_URL pointing to Neon dev branch)
npx prisma migrate dev
npx ts-node prisma/seed.ts

# 4. Run
bun run dev      # or npm run dev
```

### Environment variables

| Variable | Example | Required |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@ep-xxx-pooler.neon.tech/neondb?sslmode=require&pgbouncer=true` | Yes |
| `DIRECT_URL` | Non-pooled connection string for migrations | Yes |
| `ACCESS_TOKEN_SECRET` | 64-char random hex (signs 15-min JWT) | Yes |
| `REFRESH_TOKEN_SECRET` | 64-char random hex (validates refresh token integrity) | Yes |
| `UPSTASH_REDIS_REST_URL` | `https://xxx.upstash.io` | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token | Yes |
| `COOKIE_DOMAIN` | `durgapurhighschool.in` (leave empty for localhost) | Yes (prod) |
| `FRONTEND_URL` | `https://durgapurhighschool.in` | Yes |
| `R2_ACCOUNT_ID` | Cloudflare account ID | Yes |
| `R2_ACCESS_KEY_ID` | R2 API key | Yes |
| `R2_SECRET_ACCESS_KEY` | R2 API secret | Yes |
| `R2_BUCKET` | `durg-uploads` | Yes |
| `R2_PUBLIC_URL` | `https://pub-xxx.r2.dev` (optional CDN URL) | No |
| `RESEND_API_KEY` | `re_xxx` (for password resets & enquiry emails) | Yes |
| `BACKUP_ENCRYPTION_KEY`| 32-byte hex key for OpenSSL AES-256-CBC backup encryption | Yes (prod) |
| `PORT` | `5000` | No (default 5000) |
| `NODE_ENV` | `production` | Yes (prod) |

### Testing Strategy & Staging Load Tests

- **Unit Tests:** Vitest with mocked Prisma client for business logic, token rotation, and grace window mechanics.
- **Integration Tests:** Hono `app.request()` tests covering exact CSRF origin rejection, lockout thresholds, and upload intent verification.
- **Staging Load Tests (Mandatory):** Prior to production launch, run `k6` scripts against the staging container simulating 50–100 concurrent users accessing Study Zone resources and news. Measure memory high-water mark to ensure RSS remains strictly under 250 MB.

### CI/CD (GitHub Actions)

```yaml
# On push to main:
1. bun install --frozen-lockfile
2. npx tsc --noEmit
3. npx vitest run
4. npx prisma migrate deploy  (against Neon branch)
5. Webhook triggers Render/Railway deploy
```

### Logging & Sanitization
- Structured JSON logging with request ID.
- **Zero PII Exposure:** Passwords, refresh tokens, parent names, phone numbers, and enquiry message bodies are strictly omitted from logs.

### Health check
- **Liveness:** `GET /api/health/live` → 200 `{ "status": "ok" }` (process responsive).
- **Readiness:** `GET /api/health/ready`
  - 200 `{ "status": "ok", "db": "ok", "redis": "ok", "uptime": 1234 }` (healthy)
  - 200 `{ "status": "degraded", "db": "ok", "redis": "degraded" }` (Redis down, rate limiting falls back, app still serves requests; **does not trigger container restarts**)
  - 503 `{ "status": "unhealthy", "db": "error" }` (Database unreachable)

### Backup & Disaster Recovery Plan
- **Neon PITR:** 7-day point-in-time recovery included.
- **Encrypted Snapshots:** Weekly GitHub Actions cron executes `pg_dump`, encrypts via OpenSSL (`aes-256-cbc`) with `BACKUP_ENCRYPTION_KEY`, and uploads to private R2 `backups/` prefix.
- **Quarterly Restoration Drills:** Test restoring a snapshot into a temporary Neon dev branch to verify schema compatibility and data integrity.

---

## 11. Build Order

Each phase is scoped to fit one or two focused AI-assisted sessions.

### Phase 1: Foundation & Infrastructure (1 session)
- Init Hono project: `package.json`, `tsconfig.json`, `src/index.ts`, `config.ts` (Zod-validated env)
- Setup Upstash Redis client and Prisma client (`connection_limit=5`)
- Prisma schema:
  - `classes`, `users`, `user_roles`, `user_class_assignments`
  - `refresh_tokens`, `password_reset_tokens`, `login_attempts`
  - `upload_intents`, `pending_deletions`, `audit_logs`
- Enable PostgreSQL extensions: `pgcrypto`, `citext`
- `prisma migrate dev` + `seed.ts` (seed 12 classes, 1 admin user, sample teachers with assigned classes)
- Health endpoints: `GET /api/health/live` & `GET /api/health/ready`
- Core middleware: Hono `secureHeaders()`, CORS with exact parsed-origin validation, logger with PII masking, error handler
- **Done when:** `GET /api/health/ready` returns 200 with DB & Redis ok.

### Phase 2: Production Auth, Security & Audit (1–2 sessions)
- Dual-token lifecycle: 15-min access JWT + rotating refresh tokens with 30s grace window and `family_id` tracking
- Concurrency-safe token rotation handling multi-tab race conditions idempotently
- `POST /api/auth/login` (checks IP rate limit & account lockout thresholds → bcrypt verify → sets dual cookies)
- `POST /api/auth/refresh` (verifies token, checks grace period, rotates token pair or returns active successor)
- `POST /api/auth/logout` (revokes refresh token, clears cookies)
- `GET /api/auth/me` (verifies access cookie, checks `is_active` and `locked_until`, returns user + assigned classes)
- `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` (uses `password_reset_tokens`, Resend integration)
- Upstash Redis rate limiting on auth routes (fail-closed on login)
- Middleware: `requireAuth`, `requireTeacher`, `requireAdmin`, and class assignment checker
- Audit service: record all security events in `audit_logs`
- **Done when:** Full login, refresh rotation with 30s grace period, lockout protection, and password reset are verified via tests.

### Phase 3: Study Zone Reads & Subject Management (1 session)
- Add `subjects` + `resources` tables to schema (with `CITEXT` name uniqueness and `academic_year` support); migrate
- `GET /api/study/classes/:classId/subjects` with `resourceCount` (single aggregated SQL query, published only)
- `GET /api/study/classes/:classId/subjects/:subjectId`
- `GET /api/study/classes/:classId/subjects/:subjectId/resources` (public, published only, supports `?year=`)
- `GET /api/study/classes/:classId/subjects/:subjectId/resources/drafts` (teacher/admin only, returns drafts)
- `POST /api/study/classes/:classId/subjects` (class-scoped teacher permission check, audit log write)
- `DELETE /api/study/classes/:classId/subjects/:subjectId` (cascade delete, transactionally enqueues child resource keys into `pending_deletions`)
- Seed subjects for all 12 classes + sample resources for IX/X (matching mock data)
- **Wire frontend:** replace `study-api.ts` read methods with real API `fetch` calls
- **Done when:** Study Zone browse works in browser using real Neon data; localStorage mock removed for reads.

### Phase 4: Study Zone Writes, Upload Intents & R2 Safety (1–2 sessions)
- Upload Intent workflow:
  - `POST /api/study/upload-url` → validates teacher class scope, creates `upload_intents` row (`subject_id` FK), issues presigned R2 `PutObject` URL
  - Client uploads directly to R2
  - `POST /api/study/classes/:classId/subjects/:subjectId/resources` → checks intent, validates `HeadObject` metadata and `GetObject Range: bytes=0-15` magic bytes, stores permanent `object_key`, defaults `is_published: false`
- `PATCH /api/study/resources/:resourceId/publish` → publishes draft, writes to `audit_logs`
- Fresh Download URLs: Read endpoints generate fresh short-lived signed `GetObject` URLs on demand
- `DELETE /api/study/resources/:resourceId` → checks uploader ownership or admin, executes transactional DB delete + `pending_deletions` enqueue
- `cleanup.service.ts`: Background interval drains `pending_deletions` with exponential backoff and purges expired, abandoned upload intents
- **Wire frontend:** update `UploadDialog` and `ResourceBrowser` to call real intent and publish endpoints
- **Done when:** Teacher uploads PDF/image with verified magic bytes; file defaults to draft; deletion transactionally cleans up R2 object.

### Phase 5: News & Next.js ISR Integration (1 session)
- Add `news_articles`, `news_attachments`, `news_relations` tables; migrate
- Seed articles from current `news.ts`
- `GET /api/news` (HTTP Cache-Control `public, s-maxage=60, stale-while-revalidate=30`, no Redis read overhead)
- `GET /api/news/:slug` and `GET /api/news/:slug/related`
- **Wire frontend:** configure `fetch('/api/news', { next: { revalidate: 60 } })` in Next.js Server Components
- **Done when:** News archive and detail pages render from DB; zero Redis commands used on news reads.

### Phase 6: Admissions, Privacy & Notifications (1 session)
- Add `admission_enquiries` table with `purge_after` computed column; migrate
- `POST /api/admissions/enquiries` protected by Upstash Redis rate limiter (5 per 15 min per IP, fail-open) and Zod validation
- Instant email acknowledgement dispatched via Resend
- Log sanitization: verify zero parent PII appears in server logs
- Scheduled retention cleaner: weekly query hard-deletes closed enquiries past `purge_after`
- **Wire frontend:** connect `Admissions.onSubmit`
- **Done when:** Parent enquiry safely stored, acknowledgement email sent, PII scrubbed from logs, rate limiting active.

### Phase 7: Editorial Admin, Dashboards & Retention Management (Phase 5+ nice-to-haves)
- Admin UI for news CRUD, faculty CRUD, announcement bar updates
- Admissions enquiry management dashboard (read, mark replied, close, reveal PII action with audit log)
- Teacher class assignment management screen for admin
- Audit log explorer for admin
- **Done when:** School administration manages content without developer intervention.

---

## Risks and Unknowns

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Upstash Redis Command Quota Exceeded** | Very Low | Low | News caching handled by Next.js ISR. Redis is only used for rate limiting (~600 commands/day out of 10,000 limit = 94% headroom). Rate limiter fails-open on admissions form if Redis is unavailable. |
| **Simultaneous Refresh Token Race** | Low | Medium | Mitigated via 30-second concurrency grace window and `replaced_by_id` pointer. Concurrent browser tabs receive active successor token idempotently without triggering family revocation. |
| **Teacher Account Lockout DoS** | Low | Medium | Lockout triggers on `(email + IP)` pairs (5 attempts) rather than email alone. Global lockout requires 10 failed attempts across IPs. Teachers can still log in from alternative networks if one IP is throttled. |
| **Orphaned R2 Storage Accumulation** | Low | Low | `upload_intents` tracks incomplete uploads; `pending_deletions` queue safely drains deleted files via exponential backoff; weekly orphan reconciliation scans R2; bucket lifecycle rule cleans incomplete multipart uploads after 24 hours. |
| **Neon 0.5 GB Database Storage Limit** | Low | High | Only metadata and text are stored in PostgreSQL; all binary files strictly go to R2. |
| **R2 10 GB Free Storage Limit** | Low | Medium | School question papers and notes are small; 10 GB stores ~2,000 high-res PDFs; R2 overage cost is negligible ($0.015/GB). |
| **Memory Spikes on 512 MB Host** | Low | High — OOM | Engineering target RSS < 250 MB; Prisma pool capped to `connection_limit=5`. Memory stability and concurrency must be validated via staging load tests (k6/autocannon) prior to production launch. |
| **YouTube Videos Removed by Owners** | Medium | Low | Embed links cannot be validated indefinitely; frontend `ResourceViewer` displays a graceful fallback if a video becomes unavailable. |
| **Bengali Text Rendering & Sorting** | Low | Low | PostgreSQL UTF-8 handles Bengali natively; `CITEXT` handles case-insensitivity on English names without affecting Unicode text. |
