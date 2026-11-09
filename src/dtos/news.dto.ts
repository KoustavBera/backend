export type NewsAttachmentDTO = {
  id: string;
  title: string;
  url: string;
  type: "pdf" | "zip" | "doc" | "image";
  size: string;
};

export type NewsArticleDTO = {
  id: string;
  slug: string;
  tag: string;
  category: string;
  title: string;
  date: string;
  publishedAt: string;
  location: string;
  image: string;
  imageCaption?: string;
  desc: string;
  lead?: string;
  body: string[];
  quote?: {
    text: string;
    author: string;
    role: string;
  };
  author?: {
    name: string;
    role: string;
    email?: string;
  };
  attachments?: NewsAttachmentDTO[];
  relatedSlugs?: string[];
};

