import type { PortalDto } from './portal.js';
import type { UserDto } from './user.js';

export interface GroupDto {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  portals: PortalDto[];
  users?: UserDto[];
  portalCount?: number;
  userCount?: number;
}

export interface CreateGroupRequest {
  name: string;
  description?: string;
  portalIds?: string[];
  userIds?: string[];
}

export interface UpdateGroupRequest {
  name?: string;
  description?: string;
  portalIds?: string[];
  userIds?: string[];
}
