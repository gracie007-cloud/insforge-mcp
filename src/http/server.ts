import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { randomUUID, createHash } from 'crypto';

// Transport imports
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

// Local imports
import { getSessionManager } from './session-manager.js';
import { getRedisClient, closeRedisClient, getRedisConfig } from './redis.js';
import { getOAuthManager } from './oauth-manager.js';
import {
  SERVER_CONFIG,
  INSFORGE_CONFIG,
  OAUTH_CONFIG,
  STREAMABLE_HTTP_ENDPOINTS,
  SSE_ENDPOINTS,
  OAUTH_ENDPOINTS,
  API_ENDPOINTS,
  isOAuthConfigured,
  validateConfig,
} from './config.js';
import { renderProjectSelectionPage } from './templates/project-selection.js';

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// Parse URL-encoded bodies (for OAuth token endpoint)
app.use(express.urlencoded({ extended: true }));

// CORS and security headers middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

// ============================================================================
// Helper Functions
// ============================================================================

function isInitializeRequest(body: unknown): boolean {
  if (!body) return false;

  if (typeof body === 'object' && body !== null && 'method' in body) {
    if ((body as { method: string }).method === 'initialize') {
      return true;
    }
  }

  if (Array.isArray(body)) {
    return body.some((req: unknown) =>
      typeof req === 'object' && req !== null && 'method' in req &&
      (req as { method: string }).method === 'initialize'
    );
  }

  return false;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').substring(0, 16);
}

/**
 * Resolve project information from OAuth token
 */
async function resolveProjectFromToken(token: string): Promise<{
  apiKey: string;
  apiBaseUrl: string;
  projectId: string;
  projectName: string;
  userId: string;
  organizationId: string;
  oauthTokenHash: string;
} | null> {
  const oauthManager = getOAuthManager();
  return oauthManager.resolveProjectFromToken(token);
}

/**
 * Extract OAuth token from request headers
 */
function extractOAuthToken(req: Request): string | undefined {
  const authHeader = req.headers['authorization'] as string;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return undefined;
}

/**
 * Extract legacy headers for backwards compatibility
 */
function extractLegacyHeaders(req: Request): { apiKey?: string; apiBaseUrl?: string } {
  return {
    apiKey: req.headers['x-api-key'] as string,
    apiBaseUrl: req.headers['x-base-url'] as string,
  };
}

// ============================================================================
// Health & Discovery Endpoints
// ============================================================================

app.get(API_ENDPOINTS.health, async (_req: Request, res: Response) => {
  const sessionManager = getSessionManager();
  const stats = await sessionManager.getStats();
  const redisConfig = getRedisConfig();

  res.json({
    status: 'ok',
    server: 'insforge-mcp-remote',
    version: '1.0.0',
    protocols: {
      streamableHttp: '2025-03-26',
      sse: '2024-11-05 (deprecated)',
    },
    sessions: stats,
    redis: {
      host: redisConfig.host,
      cluster: redisConfig.cluster,
      tls: redisConfig.tls,
    },
    authentication: 'OAuth Bearer Token',
  });
});

// OAuth 2.0 Authorization Server Metadata (RFC 8414)
app.get(OAUTH_ENDPOINTS.metadata, (req: Request, res: Response) => {
  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  const baseUrl = `${protocol}://${host}`;

  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}${OAUTH_ENDPOINTS.authorize}`,
    token_endpoint: `${baseUrl}${OAUTH_ENDPOINTS.token}`,
    revocation_endpoint: `${baseUrl}${OAUTH_ENDPOINTS.revoke}`,
    registration_endpoint: `${baseUrl}${OAUTH_ENDPOINTS.register}`,
    response_types_supported: OAUTH_CONFIG.responseTypes,
    grant_types_supported: OAUTH_CONFIG.grantTypes,
    code_challenge_methods_supported: OAUTH_CONFIG.codeChallengesMethods,
    scopes_supported: OAUTH_CONFIG.supportedScopes,
  });
});

// OAuth 2.0 Protected Resource Metadata (for MCP discovery)
// The resource field must match what the client is trying to access
// We use the origin (baseUrl) as the resource identifier since both /mcp and /sse are on the same origin
app.get(OAUTH_ENDPOINTS.protectedResource, (req: Request, res: Response) => {
  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  const baseUrl = `${protocol}://${host}`;

  // Return the origin as the resource, which covers both /mcp and /sse endpoints
  // This allows OAuth to work for any endpoint on this server
  res.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
    scopes_supported: ['mcp:read', 'mcp:write'],
  });
});

// ============================================================================
// OAuth 2.0 Endpoints
// ============================================================================

/**
 * OAuth Dynamic Client Registration (RFC 7591)
 */
app.post(OAUTH_ENDPOINTS.register, async (req: Request, res: Response) => {
  const {
    client_name,
    redirect_uris,
    grant_types,
    response_types,
    token_endpoint_auth_method,
    scope,
  } = req.body;

  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({
      error: 'invalid_client_metadata',
      error_description: 'redirect_uris is required and must be a non-empty array',
    });
  }

  const clientId = `mcp_${randomUUID().replace(/-/g, '')}`;

  const redis = getRedisClient();
  const clientData = {
    client_id: clientId,
    client_name: client_name || 'MCP Client',
    redirect_uris,
    grant_types: grant_types || ['authorization_code', 'refresh_token'],
    response_types: response_types || ['code'],
    token_endpoint_auth_method: token_endpoint_auth_method || 'none',
    scope: scope || 'mcp:read mcp:write',
    created_at: Date.now(),
  };

  await redis.setex(
    `mcp:oauth:client:${clientId}`,
    30 * 24 * 60 * 60,
    JSON.stringify(clientData)
  );

  console.log(`[OAuth] Registered new client: ${clientId} (${clientData.client_name})`);

  res.status(201).json({
    client_id: clientId,
    client_name: clientData.client_name,
    redirect_uris: clientData.redirect_uris,
    grant_types: clientData.grant_types,
    response_types: clientData.response_types,
    token_endpoint_auth_method: clientData.token_endpoint_auth_method,
    scope: clientData.scope,
  });
});

/**
 * OAuth Authorization Endpoint
 * Redirects to Insforge OAuth for user authentication
 */
app.get(OAUTH_ENDPOINTS.authorize, async (req: Request, res: Response) => {
  const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method } = req.query;

  if (!isOAuthConfigured()) {
    return res.status(500).json({
      error: 'server_error',
      error_description: 'OAuth client credentials not configured. Set INSFORGE_CLIENT_ID and INSFORGE_CLIENT_SECRET.',
    });
  }

  if (!client_id || !redirect_uri || !response_type || !scope) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameters: client_id, redirect_uri, response_type, scope',
    });
  }

  if (response_type !== 'code') {
    return res.status(400).json({
      error: 'unsupported_response_type',
      error_description: 'Only response_type=code is supported',
    });
  }

  // Validate client_id and redirect_uri
  const redis = getRedisClient();
  const clientDataStr = await redis.get(`mcp:oauth:client:${client_id}`);
  if (!clientDataStr) {
    return res.status(400).json({
      error: 'invalid_client',
      error_description: 'Unknown client_id. Register client first via /oauth/register.',
    });
  }

  const clientData = JSON.parse(clientDataStr) as {
    client_id: string;
    redirect_uris: string[];
  };

  // Validate redirect_uri matches registered URIs
  if (!clientData.redirect_uris.includes(redirect_uri as string)) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'redirect_uri does not match any registered redirect URIs for this client.',
    });
  }

  try {
    const oauthManager = getOAuthManager();

    const { stateId, insforgeCodeChallenge } = await oauthManager.createAuthorizationState({
      clientId: client_id as string,
      redirectUri: redirect_uri as string,
      scope: scope as string,
      state: state as string | undefined,
      codeChallenge: code_challenge as string | undefined,
      codeChallengeMethod: code_challenge_method as string | undefined,
    });

    const authUrl = new URL(`${INSFORGE_CONFIG.apiBase}/api/oauth/v1/authorize`);
    authUrl.searchParams.set('client_id', INSFORGE_CONFIG.clientId);
    authUrl.searchParams.set('redirect_uri', OAUTH_CONFIG.callbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', INSFORGE_CONFIG.oauthScopes);
    authUrl.searchParams.set('state', stateId);
    authUrl.searchParams.set('code_challenge', insforgeCodeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    console.log(`[OAuth] Redirecting to Insforge OAuth: ${authUrl.toString()}`);
    res.redirect(authUrl.toString());
  } catch (error) {
    console.error('OAuth authorize error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to initiate authorization',
    });
  }
});

/**
 * OAuth Callback Endpoint
 * Called by Insforge OAuth after user authenticates
 */
app.get(OAUTH_ENDPOINTS.callback, async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  const oauthManager = getOAuthManager();

  if (error) {
    console.error('[OAuth] Insforge returned error:', error, error_description);
    const authState = state ? await oauthManager.getAuthorizationState(state as string) : null;

    if (authState?.redirectUri) {
      const redirectUrl = new URL(authState.redirectUri);
      redirectUrl.searchParams.set('error', error as string);
      if (error_description) {
        redirectUrl.searchParams.set('error_description', error_description as string);
      }
      if (authState.state) {
        redirectUrl.searchParams.set('state', authState.state);
      }
      return res.redirect(redirectUrl.toString());
    }

    return res.status(400).json({ error, error_description });
  }

  if (!code || !state) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameters: code, state',
    });
  }

  try {
    const authState = await oauthManager.getAuthorizationState(state as string);
    if (!authState) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Invalid or expired state',
      });
    }

    console.log('[OAuth] Exchanging code for tokens...');
    const tokenResponse = await fetch(`${INSFORGE_CONFIG.apiBase}/api/oauth/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: OAUTH_CONFIG.callbackUrl,
        client_id: INSFORGE_CONFIG.clientId,
        client_secret: INSFORGE_CONFIG.clientSecret,
        code_verifier: authState.insforgeCodeVerifier,
      }),
    });

    const tokens = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      token_type?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (tokens.error || !tokens.access_token) {
      console.error('[OAuth] Token exchange error:', tokens);
      return res.status(400).json({
        error: 'token_exchange_failed',
        error_description: tokens.error_description || tokens.error || 'No access token returned',
      });
    }

    console.log('[OAuth] Token received, redirecting to project selection...');

    const redis = getRedisClient();
    await redis.setex(
      `mcp:oauth:token:${state}`,
      10 * 60,
      tokens.access_token
    );

    res.redirect(`${SERVER_CONFIG.publicUrl}${OAUTH_ENDPOINTS.selectProject}?state_id=${state}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: error instanceof Error ? error.message : 'Failed to process callback',
    });
  }
});

/**
 * Project Selection Page (GET)
 */
app.get(OAUTH_ENDPOINTS.selectProject, async (req: Request, res: Response) => {
  const { state_id } = req.query;

  if (!state_id) {
    return res.status(400).send('Missing state_id parameter');
  }

  try {
    const oauthManager = getOAuthManager();
    const redis = getRedisClient();

    const token = await redis.get(`mcp:oauth:token:${state_id}`);
    if (!token) {
      return res.status(400).send('Session expired. Please start the authorization process again.');
    }

    const authState = await oauthManager.getAuthorizationState(state_id as string);
    if (!authState) {
      return res.status(400).send('Invalid or expired state');
    }

    const projectGroups = await oauthManager.getAvailableProjects(token);

    res.send(renderProjectSelectionPage({
      stateId: state_id as string,
      projectGroups,
      selectProjectEndpoint: OAUTH_ENDPOINTS.selectProject,
    }));
  } catch (error) {
    console.error('Project selection page error:', error);
    res.status(500).send('Failed to load projects. Please try again.');
  }
});

/**
 * Project Selection Handler (POST)
 */
app.post(OAUTH_ENDPOINTS.selectProject, async (req: Request, res: Response) => {
  const { state_id, project_id } = req.body;

  if (!state_id || !project_id) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameters: state_id, project_id',
    });
  }

  try {
    const oauthManager = getOAuthManager();
    const redis = getRedisClient();

    const token = await redis.get(`mcp:oauth:token:${state_id}`);
    if (!token) {
      return res.status(400).send('Session expired. Please start the authorization process again.');
    }

    const authState = await oauthManager.getAuthorizationState(state_id as string);
    if (!authState) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Invalid or expired state',
      });
    }

    const code = await oauthManager.createAuthorizationCode(
      state_id as string,
      token,
      project_id as string
    );

    await redis.del(`mcp:oauth:token:${state_id}`);

    const redirectUrl = new URL(authState.redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (authState.state) {
      redirectUrl.searchParams.set('state', authState.state);
    }

    console.log(`[OAuth] Authorization complete, redirecting to client: ${redirectUrl.toString()}`);
    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('Project selection error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: error instanceof Error ? error.message : 'Failed to process project selection',
    });
  }
});

/**
 * OAuth Token Endpoint
 */
app.post(OAUTH_ENDPOINTS.token, async (req: Request, res: Response) => {
  const { grant_type, code, redirect_uri, code_verifier } = req.body;

  if (grant_type === 'authorization_code') {
    if (!code || !redirect_uri) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters: code, redirect_uri',
      });
    }

    try {
      const oauthManager = getOAuthManager();
      const { tokenHash } = await oauthManager.exchangeCode(
        code as string,
        redirect_uri as string,
        code_verifier as string | undefined
      );

      res.json({
        access_token: tokenHash,
        token_type: 'Bearer',
        expires_in: 30 * 24 * 60 * 60,
        scope: 'mcp:read mcp:write',
      });
    } catch (error) {
      console.error('OAuth token error:', error);
      res.status(400).json({
        error: 'invalid_grant',
        error_description: error instanceof Error ? error.message : 'Invalid authorization code',
      });
    }
  } else if (grant_type === 'refresh_token') {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Refresh tokens are not supported',
    });
  } else {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Only authorization_code grant type is supported',
    });
  }
});

/**
 * OAuth Revocation Endpoint
 */
app.post(OAUTH_ENDPOINTS.revoke, async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing token parameter',
    });
  }

  try {
    const oauthManager = getOAuthManager();
    await oauthManager.revokeBinding(token as string);
    res.status(200).send();
  } catch {
    res.status(200).send();
  }
});

// ============================================================================
// Project API Endpoints
// ============================================================================

/**
 * Get available projects for the authenticated user
 */
app.get(API_ENDPOINTS.projects, async (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'] as string;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.substring(7);

  try {
    const oauthManager = getOAuthManager();
    const projects = await oauthManager.getAvailableProjects(token);
    res.json({ organizations: projects });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({
      error: 'Failed to get projects',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Bind token to a specific project
 */
app.post(API_ENDPOINTS.bindProject, async (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'] as string;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.substring(7);
  const projectId = req.params.projectId as string;

  try {
    const oauthManager = getOAuthManager();
    const binding = await oauthManager.bindTokenToProject(token, projectId);

    res.json({
      success: true,
      project: {
        id: binding.projectId,
        name: binding.projectName,
        organizationId: binding.organizationId,
      },
      message: 'Token successfully bound to project. You can now use this token with the MCP endpoint.',
    });
  } catch (error) {
    console.error('Bind project error:', error);
    res.status(500).json({
      error: 'Failed to bind project',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Streamable HTTP Transport (Protocol version 2025-03-26)
// Modern MCP protocol using a single endpoint
// ============================================================================

/**
 * POST /mcp - Handle MCP messages (initialize, tool calls, etc.)
 */
app.post(STREAMABLE_HTTP_ENDPOINTS.mcp, async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  const sessionManager = getSessionManager();

  const oauthToken = extractOAuthToken(req);
  const { apiKey: legacyApiKey, apiBaseUrl: legacyApiBaseUrl } = extractLegacyHeaders(req);

  console.log(`[${new Date().toISOString()}] POST ${STREAMABLE_HTTP_ENDPOINTS.mcp} - Session: ${sessionId || 'none'}, Token: ${oauthToken ? oauthToken.substring(0, 20) + '...' : 'none'}`);

  let transport: StreamableHTTPServerTransport;

  // Check if we have an existing session in memory (must be Streamable HTTP transport)
  const existingRuntime = sessionId ? sessionManager.getStreamableSession(sessionId) : null;

  if (existingRuntime) {
    transport = existingRuntime.transport;
    console.log('[Streamable HTTP] Using existing transport for session:', sessionId);
    await sessionManager.touchSession(sessionId);
  } else if (sessionId && await sessionManager.hasSession(sessionId)) {
    console.log('[Streamable HTTP] Session found in Redis, restoring:', sessionId);

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      onsessioninitialized: () => {
        console.log(`[Streamable HTTP] Session restored: ${sessionId}`);
      },
    });

    const server = await sessionManager.restoreSession(sessionId, transport);
    if (!server) {
      return res.status(500).json({
        error: 'Failed to restore session from Redis',
      });
    }
  } else if (isInitializeRequest(req.body)) {
    // New session - validate and create
    let projectInfo = oauthToken ? await resolveProjectFromToken(oauthToken) : null;

    if (!projectInfo) {
      if (!legacyApiKey && !oauthToken) {
        return res.status(401).json({
          error: 'authentication_required',
          error_description: 'Missing authentication. Provide Authorization: Bearer <OAUTH_TOKEN> or X-Api-Key header.',
          oauth_authorize_url: `${SERVER_CONFIG.publicUrl}${OAUTH_ENDPOINTS.authorize}`,
        });
      }

      if (oauthToken && !legacyApiBaseUrl) {
        return res.status(401).json({
          error: 'project_binding_required',
          error_description: 'OAuth token is valid but not bound to a project. Complete the OAuth flow or call POST /api/projects/{projectId}/bind',
          oauth_authorize_url: `${SERVER_CONFIG.publicUrl}${OAUTH_ENDPOINTS.authorize}`,
          projects_url: `${SERVER_CONFIG.publicUrl}${API_ENDPOINTS.projects}`,
        });
      }

      if (!legacyApiBaseUrl) {
        return res.status(400).json({
          error: 'Missing X-Base-URL header (required for legacy authentication).',
        });
      }

      projectInfo = {
        apiKey: legacyApiKey || oauthToken || '',
        apiBaseUrl: legacyApiBaseUrl,
        projectId: 'legacy',
        projectName: 'Legacy Session',
        userId: 'legacy',
        organizationId: 'legacy',
        oauthTokenHash: oauthToken ? hashToken(oauthToken) : 'legacy',
      };
    }

    const newSessionId = randomUUID();

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => newSessionId,
      onsessioninitialized: async (initializedSessionId) => {
        console.log(`[Streamable HTTP] Session initialized: ${initializedSessionId}`);
      },
    });

    try {
      await sessionManager.createSession(newSessionId, projectInfo, transport);
      console.log('[Streamable HTTP] New session created:', newSessionId);
    } catch (error) {
      console.error('[Streamable HTTP] Failed to create session:', error);
      return res.status(500).json({
        error: 'Failed to create session',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  } else {
    return res.status(400).json({
      error: 'Session required. Send initialize request first or provide valid Mcp-Session-Id header.',
    });
  }

  console.log('[Streamable HTTP] Handling request...');
  await transport.handleRequest(req, res, req.body);
  console.log('[Streamable HTTP] Request handled');
});

/**
 * GET /mcp - Establish SSE stream for server-to-client notifications
 */
app.get(STREAMABLE_HTTP_ENDPOINTS.mcp, async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  const authHeader = req.headers['authorization'] as string;
  const sessionManager = getSessionManager();

  console.log(`[${new Date().toISOString()}] GET ${STREAMABLE_HTTP_ENDPOINTS.mcp} - Session: ${sessionId || 'none'}, Auth: ${authHeader ? 'present' : 'missing'}`);

  if (!sessionId) {
    return res.status(400).json({
      error: 'Missing Mcp-Session-Id header.',
    });
  }

  const runtime = sessionManager.getStreamableSession(sessionId);
  if (!runtime) {
    if (await sessionManager.hasSession(sessionId)) {
      return res.status(400).json({
        error: 'Session exists but not active. Send a POST request to restore the session first.',
      });
    }
    return res.status(404).json({
      error: 'Session not found. Initialize first with POST request.',
    });
  }

  await runtime.transport.handleRequest(req, res, req.body);
});

/**
 * DELETE /mcp - Close session
 */
app.delete(STREAMABLE_HTTP_ENDPOINTS.mcp, async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  const sessionManager = getSessionManager();

  console.log(`[${new Date().toISOString()}] DELETE ${STREAMABLE_HTTP_ENDPOINTS.mcp} - Session: ${sessionId || 'none'}`);

  if (!sessionId) {
    return res.status(400).json({
      error: 'Missing Mcp-Session-Id header.',
    });
  }

  const runtime = sessionManager.getStreamableSession(sessionId);
  if (!runtime) {
    if (await sessionManager.hasSession(sessionId)) {
      await sessionManager.deleteSession(sessionId);
      return res.status(200).json({
        message: 'Session deleted from storage.',
      });
    }
    return res.status(404).json({
      error: 'Session not found.',
    });
  }

  await runtime.transport.handleRequest(req, res, req.body);
  await sessionManager.deleteSession(sessionId);
  console.log(`[Streamable HTTP] Session ${sessionId} closed`);
});

// ============================================================================
// Legacy SSE Transport (Protocol version 2024-11-05) - DEPRECATED
// For backwards compatibility with older MCP clients
// ============================================================================

// Store SSE transports by session ID (separate from Streamable HTTP transports)
const sseTransports: Map<string, SSEServerTransport> = new Map();

/**
 * GET /sse - Establish Server-Sent Events stream
 * Used by older MCP clients with "type": "sse" configuration
 */
app.get(SSE_ENDPOINTS.sse, async (req: Request, res: Response) => {
  console.log(`[${new Date().toISOString()}] GET ${SSE_ENDPOINTS.sse} - Establishing SSE connection (DEPRECATED protocol)`);

  const oauthToken = extractOAuthToken(req);
  const { apiKey: legacyApiKey, apiBaseUrl: legacyApiBaseUrl } = extractLegacyHeaders(req);

  // Resolve project info
  let projectInfo = oauthToken ? await resolveProjectFromToken(oauthToken) : null;

  if (!projectInfo) {
    if (!legacyApiKey && !oauthToken) {
      return res.status(401).json({
        error: 'authentication_required',
        error_description: 'Missing authentication. Provide Authorization: Bearer <OAUTH_TOKEN> or X-Api-Key header.',
      });
    }

    if (oauthToken && !legacyApiBaseUrl) {
      return res.status(401).json({
        error: 'project_binding_required',
        error_description: 'OAuth token is valid but not bound to a project. Complete the OAuth flow.',
      });
    }

    if (!legacyApiBaseUrl || !legacyApiKey) {
      return res.status(400).json({
        error: 'Missing X-Api-Key or X-Base-URL header (required for legacy authentication).',
      });
    }

    projectInfo = {
      apiKey: legacyApiKey,
      apiBaseUrl: legacyApiBaseUrl,
      projectId: 'legacy',
      projectName: 'Legacy Project',
      userId: 'unknown',
      organizationId: 'unknown',
      oauthTokenHash: '',
    };
  }

  // At this point projectInfo is guaranteed to be non-null
  const validProjectInfo = projectInfo;

  // Create SSE transport - it sends messages to /messages endpoint
  const transport = new SSEServerTransport(SSE_ENDPOINTS.messages, res);
  sseTransports.set(transport.sessionId, transport);

  console.log(`[SSE] Session created: ${transport.sessionId}, Project: ${validProjectInfo.projectName}`);

  // Clean up on close
  res.on('close', () => {
    console.log(`[SSE] Session closed: ${transport.sessionId}`);
    sseTransports.delete(transport.sessionId);

    // Clean up the session from SessionManager (async with error handling)
    const sessionManager = getSessionManager();
    sessionManager.deleteSession(transport.sessionId).catch((error) => {
      console.error(`[SSE] Failed to cleanup session ${transport.sessionId}:`, error);
    });
  });

  // Create and connect MCP server
  const sessionManager = getSessionManager();
  await sessionManager.createSSESession(transport.sessionId, {
    apiKey: validProjectInfo.apiKey,
    apiBaseUrl: validProjectInfo.apiBaseUrl,
    projectId: validProjectInfo.projectId,
    projectName: validProjectInfo.projectName,
    userId: validProjectInfo.userId,
    organizationId: validProjectInfo.organizationId,
    oauthTokenHash: validProjectInfo.oauthTokenHash,
  }, transport);

  console.log(`[SSE] MCP server connected for session: ${transport.sessionId}`);
});

/**
 * POST /messages - Receive messages from SSE clients
 */
app.post(SSE_ENDPOINTS.messages, async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;

  console.log(`[${new Date().toISOString()}] POST ${SSE_ENDPOINTS.messages} - Session: ${sessionId || 'none'}`);

  if (!sessionId) {
    return res.status(400).json({
      error: 'Missing sessionId query parameter',
    });
  }

  const transport = sseTransports.get(sessionId);
  if (!transport) {
    return res.status(404).json({
      error: `Session not found. Establish SSE connection first via GET ${SSE_ENDPOINTS.sse}`,
    });
  }

  await transport.handlePostMessage(req, res, req.body);
});

// ============================================================================
// Server Startup
// ============================================================================

async function startServer() {
  try {
    // Validate configuration
    validateConfig();

    // Verify Redis connection
    const redis = getRedisClient();
    await redis.ping();
    console.log('[Redis] Connection verified');

    const server = app.listen(SERVER_CONFIG.port, SERVER_CONFIG.host, () => {
      const redisConfig = getRedisConfig();
      console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║           Insforge MCP Remote Server (OAuth + Redis)                  ║
╚═══════════════════════════════════════════════════════════════════════╝

🚀 Server: http://${SERVER_CONFIG.host}:${SERVER_CONFIG.port}

┌─────────────────────────────────────────────────────────────────────────
│ 📋 Streamable HTTP Transport (Protocol 2025-03-26) - RECOMMENDED
├─────────────────────────────────────────────────────────────────────────
│   POST/GET/DELETE ${SERVER_CONFIG.publicUrl}${STREAMABLE_HTTP_ENDPOINTS.mcp}
│
│   Client config:
│   {
│     "mcpServers": {
│       "insforge": {
│         "url": "${SERVER_CONFIG.publicUrl}${STREAMABLE_HTTP_ENDPOINTS.mcp}"
│       }
│     }
│   }
└─────────────────────────────────────────────────────────────────────────

┌─────────────────────────────────────────────────────────────────────────
│ 📋 Legacy SSE Transport (Protocol 2024-11-05) - DEPRECATED
├─────────────────────────────────────────────────────────────────────────
│   GET  ${SERVER_CONFIG.publicUrl}${SSE_ENDPOINTS.sse}       (establish SSE stream)
│   POST ${SERVER_CONFIG.publicUrl}${SSE_ENDPOINTS.messages}  (send messages)
│
│   Client config:
│   {
│     "mcpServers": {
│       "insforge": {
│         "type": "sse",
│         "url": "${SERVER_CONFIG.publicUrl}${SSE_ENDPOINTS.sse}"
│       }
│     }
│   }
└─────────────────────────────────────────────────────────────────────────

🔐 OAuth 2.0 Endpoints:
   • Discovery:  ${SERVER_CONFIG.publicUrl}${OAUTH_ENDPOINTS.metadata}
   • Authorize:  ${SERVER_CONFIG.publicUrl}${OAUTH_ENDPOINTS.authorize}
   • Token:      ${SERVER_CONFIG.publicUrl}${OAUTH_ENDPOINTS.token}
   • Revoke:     ${SERVER_CONFIG.publicUrl}${OAUTH_ENDPOINTS.revoke}

🎯 Project API:
   • List:       GET  ${SERVER_CONFIG.publicUrl}${API_ENDPOINTS.projects}
   • Bind:       POST ${SERVER_CONFIG.publicUrl}${API_ENDPOINTS.bindProject}

💾 Configuration:
   • Redis:      ${redisConfig.host}:${redisConfig.port} (TLS: ${redisConfig.tls}, Cluster: ${redisConfig.cluster})
   • Insforge:   ${INSFORGE_CONFIG.apiBase}
   • Frontend:   ${INSFORGE_CONFIG.frontendUrl}
`);
    });

    const shutdown = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}, shutting down...`);

      // Close SSE transports
      console.log(`[Shutdown] Closing ${sseTransports.size} SSE connections...`);
      for (const [sessionId, transport] of sseTransports) {
        try {
          await transport.close();
        } catch (error) {
          console.error(`[Shutdown] Error closing SSE transport ${sessionId}:`, error);
        }
      }
      sseTransports.clear();

      const sessionManager = getSessionManager();
      await sessionManager.closeAllSessions();
      await closeRedisClient();

      server.close(() => {
        console.log('✅ Server shutdown complete');
        process.exit(0);
      });

      setTimeout(() => {
        console.error('⚠️ Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
