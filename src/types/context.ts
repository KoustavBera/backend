import type { UserRoleType } from "@prisma/client";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  roles: UserRoleType[];
  classes: string[]; // class IDs assigned to teacher (e.g. ['class-9', 'class-10'])
};

export type AppVariables = {
  requestId: string;
  user?: AuthUser;
};

export type AppEnv = {
  Variables: AppVariables;
};
