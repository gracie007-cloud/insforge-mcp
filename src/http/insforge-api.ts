import fetch from 'node-fetch';

/**
 * Insforge Cloud Platform API Client
 * Used for OAuth token validation and project information retrieval
 */

// Default to production, can be overridden via environment variable
const INSFORGE_API_BASE = process.env.INSFORGE_API_BASE || 'https://api.insforge.dev';

/**
 * Organization from Insforge API
 */
export interface Organization {
  id: string;
  name: string;
  type: 'personal' | 'team' | 'company';
  created_at: string;
}

/**
 * Project from Insforge API
 */
export interface Project {
  id: string;
  organization_id: string;
  name: string;
  appkey: string;
  region: string;
  status: 'active' | 'paused' | 'deleted' | 'restoring';
  instance_type: string;
  created_at: string;
}

/**
 * Project with access information
 */
export interface ProjectAccess {
  projectId: string;
  projectName: string;
  organizationId: string;
  accessHost: string;
  apiKey: string;
  region: string;
  status: string;
}

/**
 * User profile from token validation
 */
export interface UserProfile {
  id: string;
  email: string;
  name?: string;
}

/**
 * Error from Insforge API
 */
export class InsforgeApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string
  ) {
    super(message);
    this.name = 'InsforgeApiError';
  }
}

/**
 * Validate OAuth token and get user profile
 */
export async function validateToken(token: string): Promise<UserProfile> {
  const response = await fetch(`${INSFORGE_API_BASE}/auth/v1/profile`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new InsforgeApiError(
      `Token validation failed: ${errorText}`,
      response.status
    );
  }

  const data = await response.json() as { user: UserProfile };
  return data.user;
}

/**
 * Get all organizations for the authenticated user
 */
export async function getOrganizations(token: string): Promise<Organization[]> {
  const response = await fetch(`${INSFORGE_API_BASE}/organizations/v1`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new InsforgeApiError(
      `Failed to get organizations: ${errorText}`,
      response.status
    );
  }

  const data = await response.json() as { organizations: Organization[] };
  return data.organizations;
}

/**
 * Get all projects for an organization
 */
export async function getProjects(token: string, organizationId: string): Promise<Project[]> {
  const response = await fetch(`${INSFORGE_API_BASE}/organizations/v1/${organizationId}/projects`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new InsforgeApiError(
      `Failed to get projects: ${errorText}`,
      response.status
    );
  }

  const data = await response.json() as { projects: Project[] };
  return data.projects;
}

/**
 * Get project details
 */
export async function getProject(token: string, projectId: string): Promise<Project> {
  const response = await fetch(`${INSFORGE_API_BASE}/projects/v1/${projectId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new InsforgeApiError(
      `Failed to get project: ${errorText}`,
      response.status
    );
  }

  const data = await response.json() as { project: Project };
  return data.project;
}

/**
 * Get project access API key
 */
export async function getProjectApiKey(token: string, projectId: string): Promise<string> {
  const response = await fetch(`${INSFORGE_API_BASE}/projects/v1/${projectId}/access-api-key`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new InsforgeApiError(
      `Failed to get project API key: ${errorText}`,
      response.status
    );
  }

  const data = await response.json() as { access_api_key: string };
  return data.access_api_key;
}

/**
 * Build the access host URL for a project
 * Format: https://{appkey}.{region}.insforge.app
 */
export function buildAccessHost(project: Project): string {
  // Check if project has a customized domain
  if ((project as any).customized_domain) {
    return `https://${(project as any).customized_domain}`;
  }

  // Standard format: https://{appkey}.{region}.insforge.app
  return `https://${project.appkey}.${project.region}.insforge.app`;
}

/**
 * Get complete project access information
 * This is the main function used to resolve project info from OAuth token + project selection
 */
export async function getProjectAccess(
  token: string,
  projectId: string
): Promise<ProjectAccess> {
  // Get project details and API key in parallel
  const [project, apiKey] = await Promise.all([
    getProject(token, projectId),
    getProjectApiKey(token, projectId),
  ]);

  return {
    projectId: project.id,
    projectName: project.name,
    organizationId: project.organization_id,
    accessHost: buildAccessHost(project),
    apiKey,
    region: project.region,
    status: project.status,
  };
}

/**
 * Get all projects across all organizations (for project selection UI)
 */
export async function getAllUserProjects(token: string): Promise<Array<{
  organization: Organization;
  projects: Project[];
}>> {
  const organizations = await getOrganizations(token);

  const results = await Promise.all(
    organizations.map(async (org) => {
      const projects = await getProjects(token, org.id);
      return {
        organization: org,
        projects: projects.filter(p => p.status === 'active'), // Only active projects
      };
    })
  );

  return results.filter(r => r.projects.length > 0); // Only orgs with active projects
}
