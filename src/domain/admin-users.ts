export type AccountRole = "viewer" | "reviewer" | "admin";
export interface ManagedUser {
  id: string;
  email: string;
  role: AccountRole;
  active: boolean;
  createdAt: string;
  version: number;
}
export interface UserPage {
  items: ManagedUser[];
  total: number;
  offset: number;
  limit: number;
}
export interface AccountUpdate {
  expectedVersion: number;
  email?: string;
  role?: AccountRole;
  active?: boolean;
}
