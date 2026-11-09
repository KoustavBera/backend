export type AnnouncementSeverityDTO = "info" | "warning" | "urgent";

export interface AnnouncementDTO {
  id: string;
  textEn: string;
  textBn?: string | null;
  text: string; // resolved text based on requested lang (en/bn)
  link?: string | null;
  severity: AnnouncementSeverityDTO;
  isActive: boolean;
  sortOrder: number;
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnouncementInput {
  textEn: string;
  textBn?: string | null;
  link?: string | null;
  severity?: AnnouncementSeverityDTO;
  isActive?: boolean;
  sortOrder?: number;
  startDate?: string | null;
  endDate?: string | null;
}

export interface UpdateAnnouncementInput {
  textEn?: string;
  textBn?: string | null;
  link?: string | null;
  severity?: AnnouncementSeverityDTO;
  isActive?: boolean;
  sortOrder?: number;
  startDate?: string | null;
  endDate?: string | null;
}

