import { createHash, randomBytes } from 'crypto';
import { getRedisClient } from './redis.js';
import {
  validateToken,
  getProjectAccess,
  getAllUserProjects,
  type ProjectAccess,
  type Organization,
  type Project,
  InsforgeApiError,
} from './insforge-api.js';

// ============================================================================
// PKCE Helpers
// ============================================================================

/**
 * Generate a random code verifier for PKCE
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Generate code challenge from verifier (SHA256)
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generate random state for CSRF protection
 */
export function generateState(): string {
  return randomBytes(16).toString('hex');
}

/**
 * OAuth authorization state stored in Redis
 * Used during the OAuth flow before token exchange
 *
 * This stores both:
 * 1. The MCP client's original request parameters
 * 2. The PKCE verifier we generate when calling Insforge OAuth
 */
interface AuthorizationState {
  // Original MCP client request
  clientId: string;
  redirectUri: string;
  scope: string;
  state?: string;
  codeChallenge?: string;  // From MCP client (if using PKCE)
  codeChallengeMethod?: string;

  // Our PKCE verifier for calling Insforge OAuth
  insforgeCodeVerifier: string;

  createdAt: number;
}

/**
 * Token binding stored in Redis
 * Links an OAuth token to a specific project
 */
interface TokenBinding {
  tokenHash: string;
  userId: string;
  userEmail: string;
  projectId: string;
  projectName: string;
  organizationId: string;
  accessHost: string;
  apiKey: string;
  createdAt: number;
  lastUsedAt: number;
}

// Redis key prefixes
const AUTH_STATE_PREFIX = 'mcp:auth:state:';
const TOKEN_BINDING_PREFIX = 'mcp:auth:binding:';
const AUTH_CODE_PREFIX = 'mcp:auth:code:';

// TTLs
const AUTH_STATE_TTL = 10 * 60; // 10 minutes
const AUTH_CODE_TTL = 5 * 60; // 5 minutes
const TOKEN_BINDING_TTL = 30 * 24 * 60 * 60; // 30 days

/**
 * Generate a hash of the token for storage
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a random code
 */
function generateCode(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * OAuthManager handles the OAuth authorization flow and token-to-project binding
 */
export class OAuthManager {
  /**
   * Create a new authorization state (step 1 of OAuth flow)
   * Returns a state ID and the PKCE code challenge for Insforge OAuth
   */
  async createAuthorizationState(params: {
    clientId: string;
    redirectUri: string;
    scope: string;
    state?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
  }): Promise<{ stateId: string; insforgeCodeChallenge: string }> {
    const redis = getRedisClient();
    const stateId = generateCode();

    // Generate PKCE verifier for our request to Insforge
    const insforgeCodeVerifier = generateCodeVerifier();
    const insforgeCodeChallenge = generateCodeChallenge(insforgeCodeVerifier);

    const authState: AuthorizationState = {
      ...params,
      insforgeCodeVerifier,
      createdAt: Date.now(),
    };

    await redis.setex(
      AUTH_STATE_PREFIX + stateId,
      AUTH_STATE_TTL,
      JSON.stringify(authState)
    );

    return { stateId, insforgeCodeChallenge };
  }

  /**
   * Get authorization state
   */
  async getAuthorizationState(stateId: string): Promise<AuthorizationState | null> {
    const redis = getRedisClient();
    const data = await redis.get(AUTH_STATE_PREFIX + stateId);

    if (!data) {
      return null;
    }

    return JSON.parse(data) as AuthorizationState;
  }

  /**
   * Create an authorization code after user approves and selects a project
   * Returns the code to be exchanged for a token
   */
  async createAuthorizationCode(
    stateId: string,
    token: string,
    projectId: string
  ): Promise<string> {
    const redis = getRedisClient();

    // Validate the state exists
    const authState = await this.getAuthorizationState(stateId);
    if (!authState) {
      throw new Error('Invalid or expired authorization state');
    }

    // Validate token and get user info
    const user = await validateToken(token);

    // Get project access info
    const projectAccess = await getProjectAccess(token, projectId);

    // Create token binding
    const tokenHash = hashToken(token);
    const binding: TokenBinding = {
      tokenHash,
      userId: user.id,
      userEmail: user.email,
      projectId: projectAccess.projectId,
      projectName: projectAccess.projectName,
      organizationId: projectAccess.organizationId,
      accessHost: projectAccess.accessHost,
      apiKey: projectAccess.apiKey,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    // Store the binding
    await redis.setex(
      TOKEN_BINDING_PREFIX + tokenHash,
      TOKEN_BINDING_TTL,
      JSON.stringify(binding)
    );

    // Create authorization code that references the token hash
    const code = generateCode();
    await redis.setex(
      AUTH_CODE_PREFIX + code,
      AUTH_CODE_TTL,
      JSON.stringify({
        tokenHash,
        stateId,
        redirectUri: authState.redirectUri,
        codeChallenge: authState.codeChallenge,
        codeChallengeMethod: authState.codeChallengeMethod,
      })
    );

    // Clean up the state
    await redis.del(AUTH_STATE_PREFIX + stateId);

    return code;
  }

  /**
   * Exchange authorization code for token binding info
   * This is called by the MCP client after OAuth callback
   */
  async exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier?: string
  ): Promise<{ tokenHash: string }> {
    const redis = getRedisClient();
    const codeData = await redis.get(AUTH_CODE_PREFIX + code);

    if (!codeData) {
      throw new Error('Invalid or expired authorization code');
    }

    const { tokenHash, redirectUri: storedRedirectUri, codeChallenge, codeChallengeMethod } =
      JSON.parse(codeData);

    // Validate redirect URI
    if (redirectUri !== storedRedirectUri) {
      throw new Error('Redirect URI mismatch');
    }

    // Validate PKCE if used
    if (codeChallenge) {
      if (!codeVerifier) {
        throw new Error('Code verifier required');
      }

      let computedChallenge: string;
      if (codeChallengeMethod === 'S256') {
        computedChallenge = createHash('sha256')
          .update(codeVerifier)
          .digest('base64url');
      } else {
        computedChallenge = codeVerifier;
      }

      if (computedChallenge !== codeChallenge) {
        throw new Error('Code verifier mismatch');
      }
    }

    // Delete the code (single use)
    await redis.del(AUTH_CODE_PREFIX + code);

    return { tokenHash };
  }

  /**
   * Get token binding by token hash
   */
  async getTokenBinding(tokenHash: string): Promise<TokenBinding | null> {
    const redis = getRedisClient();
    const data = await redis.get(TOKEN_BINDING_PREFIX + tokenHash);

    if (!data) {
      return null;
    }

    return JSON.parse(data) as TokenBinding;
  }

  /**
   * Get token binding by raw token
   */
  async getBindingByToken(token: string): Promise<TokenBinding | null> {
    const tokenHash = hashToken(token);
    return this.getTokenBinding(tokenHash);
  }

  /**
   * Update last used time for a token binding
   */
  async touchBinding(tokenHash: string): Promise<void> {
    const redis = getRedisClient();
    const binding = await this.getTokenBinding(tokenHash);

    if (binding) {
      binding.lastUsedAt = Date.now();
      await redis.setex(
        TOKEN_BINDING_PREFIX + tokenHash,
        TOKEN_BINDING_TTL,
        JSON.stringify(binding)
      );
    }
  }

  /**
   * Revoke a token binding
   */
  async revokeBinding(tokenHash: string): Promise<void> {
    const redis = getRedisClient();
    await redis.del(TOKEN_BINDING_PREFIX + tokenHash);
  }

  /**
   * Resolve project info from OAuth token or tokenHash
   * This is the main entry point used by the MCP server
   *
   * The token parameter can be either:
   * 1. A tokenHash (returned by /oauth/token endpoint) - used by MCP clients after OAuth
   * 2. A raw Insforge OAuth token - used for direct API access
   *
   * Flow:
   * 1. Try to find binding using token directly as tokenHash
   * 2. If not found, try hashing the token and look up again
   * 3. If still not found, return null (client needs to go through OAuth flow)
   */
  async resolveProjectFromToken(token: string): Promise<{
    apiKey: string;
    apiBaseUrl: string;
    projectId: string;
    projectName: string;
    userId: string;
    organizationId: string;
    oauthTokenHash: string;
  } | null> {
    // First, try using the token directly as a tokenHash
    // This handles the case where MCP clients send the tokenHash from /oauth/token
    let binding = await this.getTokenBinding(token);
    let actualTokenHash = token;

    if (!binding) {
      // Try hashing the token (in case it's a raw Insforge token)
      actualTokenHash = hashToken(token);
      binding = await this.getTokenBinding(actualTokenHash);
    }

    if (!binding) {
      // No binding found - client needs to complete OAuth flow
      return null;
    }

    // Update last used time
    await this.touchBinding(actualTokenHash);

    return {
      apiKey: binding.apiKey,
      apiBaseUrl: binding.accessHost,
      projectId: binding.projectId,
      projectName: binding.projectName,
      userId: binding.userId,
      organizationId: binding.organizationId,
      oauthTokenHash: actualTokenHash,
    };
  }

  /**
   * Get all available projects for a user (for project selection UI)
   */
  async getAvailableProjects(token: string): Promise<Array<{
    organization: Organization;
    projects: Project[];
  }>> {
    return getAllUserProjects(token);
  }

  /**
   * Bind a token to a project directly (skip OAuth code flow)
   * Used when user selects a project via API
   */
  async bindTokenToProject(token: string, projectId: string): Promise<TokenBinding> {
    const redis = getRedisClient();

    // Validate token and get user info
    const user = await validateToken(token);

    // Get project access info
    const projectAccess = await getProjectAccess(token, projectId);

    // Create token binding
    const tokenHash = hashToken(token);
    const binding: TokenBinding = {
      tokenHash,
      userId: user.id,
      userEmail: user.email,
      projectId: projectAccess.projectId,
      projectName: projectAccess.projectName,
      organizationId: projectAccess.organizationId,
      accessHost: projectAccess.accessHost,
      apiKey: projectAccess.apiKey,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    // Store the binding
    await redis.setex(
      TOKEN_BINDING_PREFIX + tokenHash,
      TOKEN_BINDING_TTL,
      JSON.stringify(binding)
    );

    console.log(`[OAuthManager] Token bound to project: ${projectAccess.projectName}`);
    return binding;
  }
}

// Singleton instance
let oauthManager: OAuthManager | null = null;

export function getOAuthManager(): OAuthManager {
  if (!oauthManager) {
    oauthManager = new OAuthManager();
  }
  return oauthManager;
}
