import type { GalleryCategory } from "@prisma/client";

export type GalleryCategoryDTO = "campus" | "events" | "sports" | "academics" | "celebrations";

export interface GalleryPhotoDTO {
  id: string;
  title: string;
  titleBn?: string | null;
  category: GalleryCategoryDTO;
  description?: string | null;
  url: string;
  photoKey: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGalleryPhotoInput {
  title: string;
  titleBn?: string | null;
  category?: GalleryCategoryDTO;
  description?: string | null;
  photoKey?: string | null;
  uploadIntentId?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface UpdateGalleryPhotoInput {
  title?: string;
  titleBn?: string | null;
  category?: GalleryCategoryDTO;
  description?: string | null;
  photoKey?: string | null;
  uploadIntentId?: string;
  sortOrder?: number;
  isActive?: boolean;
}

