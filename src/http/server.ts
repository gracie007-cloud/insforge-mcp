import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { program } from 'commander';
import express, { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { registerInsforgeTools } from '../shared/tools.js';

// Parse command line arguments
program
  .option('--port <number>', 'Port to run HTTP server on', '3000');
program.parse(process.argv);
const options = program.opts();
const { port } = options;

const PORT = parseInt(port) || 3000;

// Track active transports by session ID
const transports = new Map<string, StreamableHTTPServerTransport>();
// Track McpServer instances for proper cleanup
const servers = new Map<string, McpServer>();

// Create Express app
const app = express();

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// CORS and security headers middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, X-Base-URL, Mcp-Session-Id, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    server: 'insforge-mcp-streamable',
    version: '1.0.0',
    protocol: 'Streamable HTTP',
    sessions: transports.size,
    authentication: 'per-request via headers',
    requiredHeaders: {
      'Authorization': 'Bearer <API_KEY>',
      'X-Base-URL': '<BACKEND_URL> (e.g. http://localhost:7130)'
    },
  });
});

// Helper to check if request is an initialization
function isInitializeRequest(body: any): boolean {
  if (!body) return false;
  
  // Single request
  if (body.method === 'initialize') {
    return true;
  }
  
  // Batch request
  if (Array.isArray(body)) {
    return body.some((req: any) => req.method === 'initialize');
  }
  
  return false;
}

// Handle POST requests to /mcp
app.post('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  console.log(`[${new Date().toISOString()}] POST /mcp - Session: ${sessionId || 'none'}`);
  
  // Extract API key and base URL from headers
  const authHeader = req.headers['authorization'] as string;
  let apiKey: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7);
  }
  const apiBaseUrl = req.headers['x-base-url'] as string;
  
  let transport: StreamableHTTPServerTransport;
  let mcpServer: McpServer | undefined;
  
  // Check if we have an existing session
  if (sessionId && transports.has(sessionId)) {
    transport = transports.get(sessionId)!;
    console.log('Using existing transport for session:', sessionId);
  } else if (isInitializeRequest(req.body)) {
    // New session - validate headers
    if (!apiKey) {
      return res.status(401).json({
        error: 'Missing required Authorization header. Expected: Authorization: Bearer <API_KEY>',
      });
    }
    if (!apiBaseUrl) {
      return res.status(400).json({
        error: 'Missing required X-Base-URL header. Expected: X-Base-URL: <BACKEND_URL>',
      });
    }
    
    // Create new transport with session initialization callback
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        // Store the transport and server by session ID
        console.log(`Session initialized: ${sessionId}`);
        transports.set(sessionId, transport);
        if (mcpServer) {
          servers.set(sessionId, mcpServer);
        }
      },
    });
    
    // Create and connect MCP server
    mcpServer = new McpServer({
      name: 'insforge-mcp',
      version: '1.0.0',
    });
    
    // Register tools with user's API key and base URL (async to support dynamic version-based registration)
    await registerInsforgeTools(mcpServer, {
      apiKey,
      apiBaseUrl,
    });

    // Connect server to transport AFTER tool registration is complete
    console.log('Connecting server to transport...');
    await mcpServer.connect(transport);
    console.log('Server connected successfully');
  } else {
    // No session and not an init request
    return res.status(400).json({
      error: 'Session required. Send initialize request first or provide Mcp-Session-Id header.',
    });
  }
  
  // Let the transport handle the request
  console.log('Handling request with transport...');
  await transport.handleRequest(req, res, req.body);
  console.log('Request handled');
  
  // The onsessioninitialized callback handles storing the transport and server
  // No need to manually store them here anymore
});

// Handle GET requests to /mcp (for SSE)
app.get('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  console.log(`[${new Date().toISOString()}] GET /mcp - Session: ${sessionId || 'none'}`);
  
  if (!sessionId || !transports.has(sessionId)) {
    return res.status(404).json({
      error: 'Session not found. Initialize first with POST request.',
    });
  }
  
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res, req.body);
});

// Handle DELETE requests to close sessions
app.delete('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  console.log(`[${new Date().toISOString()}] DELETE /mcp - Session: ${sessionId || 'none'}`);
  
  if (!sessionId || !transports.has(sessionId)) {
    return res.status(404).json({
      error: 'Session not found.',
    });
  }
  
  const transport = transports.get(sessionId)!;
  const server = servers.get(sessionId);
  
  await transport.handleRequest(req, res, req.body);
  
  // Clean up server and transport
  if (server) {
    await server.close();
    servers.delete(sessionId);
  }
  transports.delete(sessionId);
  console.log(`Session ${sessionId} closed`);
});

// Start server
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║         Insforge MCP Streamable HTTP Server             ║
╚══════════════════════════════════════════════════════════╝

🚀 Server: http://127.0.0.1:${PORT}
🔗 Endpoint: http://127.0.0.1:${PORT}/mcp
💚 Health: http://127.0.0.1:${PORT}/health

📋 Protocol: Streamable HTTP (2024-11-05+ spec)
🔐 Required Headers (per-request):
   • Authorization: Bearer <API_KEY>
   • X-Base-URL: <BACKEND_URL>

📝 Client Configuration Example:
{
  "mcpServers": {
    "insforge": {
      "url": "http://127.0.0.1:${PORT}/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY",
        "X-Base-URL": "http://localhost:7130"
      }
    }
  }
}

🔄 Session Management: Automatic (stateful)
🛡️  Security: Binding to localhost only (127.0.0.1)
`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  
  // Close all servers and transports
  for (const [sessionId, server] of servers.entries()) {
    try {
      console.log(`Closing session: ${sessionId}`);
      await server.close();
      const transport = transports.get(sessionId);
      if (transport) {
        await transport.close();
      }
    } catch (error) {
      console.error(`Error closing session ${sessionId}:`, error);
    }
  }
  servers.clear();
  transports.clear();
  
  // Close HTTP server
  server.close(() => {
    console.log('✅ Server shutdown complete');
    process.exit(0);
  });
});