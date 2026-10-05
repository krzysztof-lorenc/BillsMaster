export type UserRole = 'ADMIN' | 'USER';

export interface UserGroupInfo {
  id: string;
  name: string;
  description?: string | null;
}

export type ThemeMode = 'dark' | 'light';

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  theme?: ThemeMode;
  createdAt: string;
  updatedAt: string;
  groups?: UserGroupInfo[];
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  theme?: ThemeMode;
  groups?: UserGroupInfo[];
}

export interface UpdateThemeRequest {
  theme: ThemeMode;
}

export interface SetupAdminRequest {
  email: string;
  name: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreateUserRequest {
  email: string;
  name: string;
  password: string;
  role?: UserRole;
  groupIds?: string[];
}

export interface UpdateUserRequest {
  name?: string;
  email?: string;
  isActive?: boolean;
  password?: string;
  groupIds?: string[];
}

export interface SystemStatusResponse {
  isConfigured: boolean;
  version: string;
}
