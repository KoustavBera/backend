export interface FacultyDTO {
  id: string;
  slug: string;
  name: string;
  nameBn?: string | null;
  designation: string;
  designationBn?: string | null;
  department: string;
  education: string;
  educationBn?: string | null;
  description?: string | null;
  image: string;
  photoKey?: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFacultyInput {
  name: string;
  nameBn?: string | null;
  slug?: string | null;
  designation: string;
  designationBn?: string | null;
  department?: string;
  education: string;
  educationBn?: string | null;
  description?: string | null;
  photoKey?: string | null;
  uploadIntentId?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface UpdateFacultyInput {
  name?: string;
  nameBn?: string | null;
  slug?: string | null;
  designation?: string;
  designationBn?: string | null;
  department?: string;
  education?: string;
  educationBn?: string | null;
  description?: string | null;
  photoKey?: string | null;
  uploadIntentId?: string;
  sortOrder?: number;
  isActive?: boolean;
}
