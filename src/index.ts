#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from 'node-fetch';
import { program } from "commander";
import { handleApiResponse, formatSuccessMessage } from './response-handler.js';
import { promises as fs } from 'fs';
import path from 'path';

// Parse command line arguments
program
  .option('--api_key <value>', 'API Key');
program.parse(process.argv);
const options = program.opts();
const { api_key } = options;

const GLOBAL_API_KEY = api_key || process.env.API_KEY || '';

const server = new McpServer({
  name: "insforge-mcp",
  version: "1.0.0"
});

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:7130";

// Helper function to get API key (use global if provided, otherwise require it in tool calls)
const getApiKey = (toolApiKey?: string): string => {
  if (GLOBAL_API_KEY) return GLOBAL_API_KEY;
  if (toolApiKey) return toolApiKey;
  throw new Error('API key is required. Either pass --api_key as command line argument or provide api_key in tool calls.');
};

// Helper function to rdocumentation from backend
const fetchDocumentation = async (docType: string): Promise<string> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/docs/${docType}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await handleApiResponse(response);
    
    // Traditional REST format - data returned directly as { type, content }
    if (result && typeof result === 'object' && 'content' in result) {
      return result.content;
    }
    
    throw new Error('Invalid response format from documentation endpoint');
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
    throw new Error(`Unable to retrieve ${docType} documentation: ${errMsg}`);
  }
};

// --------------------------------------------------
// Instruction Tools

// Get main instructions for AI agents
server.tool(
  "get-instructions",
  "Instruction Essential backend setup tool. <critical>MANDATORY: You MUST use this tool FIRST before attempting any backend operations. Contains required API endpoints, authentication details, and setup instructions.</critical>",
  {},
  async () => {
    try {
      const content = await fetchDocumentation('instructions');
      return { 
        content: [{ 
          type: "text", 
          text: content
        }] 
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return { 
        content: [{ type: "text", text: `Error: ${errMsg}` }] 
      };
    }
  }
);

server.tool(
  "debug-backend",
  "Debug Insforge backend issues requires this tool. <critical>MANDATORY: Always use this tool FIRST when encountering backend errors, API failures, or backend questions. It will diagnose issues by reading all documentation, verifying current state, and testing with curl.</critical>",
  {},
  async () => {
    try {
      const content = await fetchDocumentation('debug');
      return { 
        content: [{ 
          type: "text", 
          text: content
        }] 
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return { 
        content: [{ type: "text", text: `Error: ${errMsg}` }] 
      };
    }
  }
);

server.tool(
  "get-api-key",
  "Retrieves the API key for the Insforge OSS backend. This is used to authenticate all requests to the backend.",
  {},
  async () => {
    try {
      return {
        content: [{ type: "text", text: `API key: ${getApiKey()}` }]
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return { 
        content: [{ type: "text", text: `Error: ${errMsg}` }] 
      };
    }
  }
);

// Get database API documentation  
server.tool(
  "get-db-api",
  "Retrieves documentation for Insforge OSS database CRUD operations, including automatic table creation and smart schema management",
  {},
  async () => {
    try {
      const content = await fetchDocumentation('db-api');
      return { 
        content: [{ 
          type: "text", 
          text: content
        }] 
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return { 
        content: [{ type: "text", text: `Error: ${errMsg}` }] 
      };
    }
  }
);

// Get authentication API documentation
server.tool(
  "get-auth-api",
  "Retrieves documentation for Insforge OSS authentication API, including JWT tokens, project management, and API key generation",
  {},
  async () => {
    try {
      const content = await fetchDocumentation('auth-api');
      return { 
        content: [{ 
          type: "text", 
          text: content
        }] 
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return { 
        content: [{ type: "text", text: `Error: ${errMsg}` }] 
      };
    }
  }
);

// Get storage API documentation
server.tool(
  "get-storage-api",
  "Retrieves documentation for Insforge OSS file storage API, including file uploads, metadata handling, and automatic cleanup",
  {},
  async () => {
    try {
      const content = await fetchDocumentation('storage-api');
      return { 
        content: [{ 
          type: "text", 
          text: content
        }] 
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return { 
        content: [{ type: "text", text: `Error: ${errMsg}` }] 
      };
    }
  }
);

// Download project-specific rules (CLAUDE.md and cursor rules)
server.tool(
  "download-project-rules",
  "Download project-specific rules (CLAUDE.md and cursor rules) <critical>MANDATORY: You MUST use this tool when starting a new project</critical>",
  {},
  async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/docs/project`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const result = await handleApiResponse(response);
      
      // Traditional REST format - data returned directly as { type, content }
      if (result && typeof result === 'object' && 'content' in result) {
        const outputs = [];
        
        // Save as CLAUDE.md
        const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');
        await fs.writeFile(claudeMdPath, result.content, 'utf-8');
        outputs.push(`✓ Saved CLAUDE.md to: ${claudeMdPath}`);
        
        // Also save as cursor rules (same content works for both)
        const cursorRulesDir = path.join(process.cwd(), '.cursor', 'rules');
        const cursorRulesPath = path.join(cursorRulesDir, 'cursor-rules.mdc');
        
        // Create directory if it doesn't exist
        await fs.mkdir(cursorRulesDir, { recursive: true });
        await fs.writeFile(cursorRulesPath, result.content, 'utf-8');
        outputs.push(`✓ Saved cursor rules to: ${cursorRulesPath}`);
        
        return {
          content: [{
            type: "text",
            text: outputs.join('\n')
          }]
        };
      }
      
      throw new Error('Invalid response format from project rules endpoint');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{
          type: "text",
          text: `Error downloading project rules: ${errMsg}`
        }],
        isError: true
      };
    }
  }
);

// --------------------------------------------------
// Core Database Tools


server.tool(
  "create-table",
  "Create a new table with explicit schema definition",
  {
    api_key: z.string().optional().describe("API key for authentication (optional if provided via --api_key)"),
    table_name: z.string().describe("Name of the table to create"),
    columns: z.array(z.object({
      name: z.string().describe("Column name"),
      type: z.string().describe("Column type (e.g., string, integer, float, boolean, datetime, uuid, json)"),
      unique: z.boolean().optional().describe("Whether the column is unique"),
      nullable: z.boolean().describe("Whether the column can be null"),
      defaultValue: z.string().optional().describe("Default value for the column"),
      foreign_key: z.object({
        table: z.string().describe("Name of the foreign table"),
        column: z.string().describe("Name of the foreign column"),
        on_delete: z.string().optional().describe("ON DELETE action (CASCADE, SET NULL, RESTRICT, NO ACTION)"),
        on_update: z.string().optional().describe("ON UPDATE action (CASCADE, SET NULL, RESTRICT, NO ACTION)")
      }).optional().describe("Foreign key information")
    })).describe("Array of column definitions")
  },
  async ({ api_key, table_name, columns }) => {
    try {
      const actualApiKey = getApiKey(api_key);
      const response = await fetch(`${API_BASE_URL}/api/database/tables`, {
        method: 'POST',
        headers: {
          'x-api-key': actualApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          table_name,
          columns
        })
      });

      const result = await handleApiResponse(response);
      
      return {
        content: [{
          type: "text",
          text: formatSuccessMessage('Table created', result)
        }]
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{
          type: "text",
          text: `Error creating table: ${errMsg}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "delete-table",
  "Permanently deletes a table and all its data",
  {
    api_key: z.string().optional().describe("API key for authentication (optional if provided via --api_key)"),
    table_name: z.string().describe("Name of the table to delete")
  },
  async ({ api_key, table_name }) => {
    try {
      const actualApiKey = getApiKey(api_key);
      const response = await fetch(`${API_BASE_URL}/api/database/tables/${table_name}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': actualApiKey,
          'Content-Type': 'application/json'
        }
      });

      const result = await handleApiResponse(response);
      
      return {
        content: [{
          type: "text",
          text: formatSuccessMessage('Table deleted', result)
        }]
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{
          type: "text",
          text: `Error deleting table: ${errMsg}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "modify-table",
  "Alters table schema - add, drop, or rename columns",
  {
    api_key: z.string().optional().describe("API key for authentication (optional if provided via --api_key)"),
    table_name: z.string().describe("Name of the table to modify"),
    add_columns: z.array(z.object({
      name: z.string().describe("Column name"),
      type: z.string().describe("Column type (string, integer, float, boolean, datetime, uuid, json)"),
      unique: z.boolean().optional().describe("Whether the column is unique"),
      nullable: z.boolean().optional().describe("Whether the column allows NULL values"),
      defaultValue: z.string().optional().describe("Default value for the column"),
      foreign_key: z.object({
        table: z.string().describe("Name of the foreign table"),
        column: z.string().describe("Name of the foreign column"),
        on_delete: z.string().optional().describe("ON DELETE action (CASCADE, SET NULL, RESTRICT, NO ACTION)"),
        on_update: z.string().optional().describe("ON UPDATE action (CASCADE, SET NULL, RESTRICT, NO ACTION)")
      }).optional().describe("Foreign key information")
    })).optional().describe("Columns to add to the table"),
    drop_columns: z.array(z.string()).optional().describe("Names of columns to drop from the table"),
    rename_columns: z.record(z.string()).optional().describe("Object mapping old column names to new names"),
    add_fkey_columns: z.array(z.object({
      name: z.string().describe("Name of existing column to add foreign key to"),
      foreign_key: z.object({
        table: z.string().describe("Name of the foreign table"),
        column: z.string().describe("Name of the foreign column"),
        on_delete: z.string().optional().describe("ON DELETE action (CASCADE, SET NULL, RESTRICT, NO ACTION)"),
        on_update: z.string().optional().describe("ON UPDATE action (CASCADE, SET NULL, RESTRICT, NO ACTION)")
      }).describe("Foreign key constraint details")
    })).optional().describe("Foreign key constraints to add to existing columns"),
    drop_fkey_columns: z.array(z.object({
      name: z.string().describe("Name of column to remove foreign key from")
    })).optional().describe("Foreign key constraints to remove from columns")
  },
  async ({ api_key, table_name, add_columns, drop_columns, rename_columns, add_fkey_columns, drop_fkey_columns }) => {
    try {
      const actualApiKey = getApiKey(api_key);
      const body: any = {};
      if (add_columns) body.add_columns = add_columns;
      if (drop_columns) body.drop_columns = drop_columns;
      if (rename_columns) body.rename_columns = rename_columns;
      if (add_fkey_columns) body.add_fkey_columns = add_fkey_columns;
      if (drop_fkey_columns) body.drop_fkey_columns = drop_fkey_columns;

      const response = await fetch(`${API_BASE_URL}/api/database/tables/${table_name}`, {
        method: 'PATCH',
        headers: {
          'x-api-key': actualApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const result = await handleApiResponse(response);
      
      return {
        content: [{
          type: "text",
          text: formatSuccessMessage('Table modified', result)
        }]
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{
          type: "text",
          text: `Error modifying table: ${errMsg}`
        }],
        isError: true
      };
    }
  }
);

// Get table schema
server.tool(
  "get-table-schema",
  "Returns the schema of a specific table",
  {
    api_key: z.string().optional().describe("API key for authentication (optional if provided via --api_key)"),
    table_name: z.string().describe("Name of the table")
  },
  async ({ api_key, table_name }) => {
    try {
      const actualApiKey = getApiKey(api_key);
      const response = await fetch(`${API_BASE_URL}/api/database/tables/${table_name}/schema`, {
        method: 'GET',
        headers: {
          'x-api-key': actualApiKey
        }
      });

      const result = await handleApiResponse(response);
      
      return {
        content: [{
          type: "text",
          text: formatSuccessMessage('Schema retrieved', result)
        }]
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{
          type: "text",
          text: `Error getting table schema: ${errMsg}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "get-backend-metadata",
  "Index all backend metadata",
  {
    api_key: z.string().optional().describe("API key for authentication (optional if provided via --api_key)")
  },
  async ({ api_key }) => {
    try {
      const actualApiKey = getApiKey(api_key);
      const response = await fetch(`${API_BASE_URL}/api/metadata`, {
        method: 'GET',
        headers: {
          'x-api-key': actualApiKey
        }
      });

      const metadata = await handleApiResponse(response);
      
      return {
        content: [{
          type: "text",
          text: `Backend metadata:\n\n${JSON.stringify(metadata, null, 2)}`
        }]
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{
          type: "text",
          text: `Error retrieving backend metadata: ${errMsg}`
        }],
        isError: true
      };
    }
  }
);

// --------------------------------------------------
// Storage Tools

// Create storage bucket
server.tool(
  "create-bucket",
  "Create new storage bucket",
  {
    api_key: z.string().optional().describe("API key for authentication (optional if provided via --api_key)"),
    bucket_name: z.string().describe("Name of the bucket to create"),
    public: z.boolean().optional().describe("Whether the bucket should be public (optional)")
  },
  async ({ api_key, bucket_name }) => {
    try {
      const actualApiKey = getApiKey(api_key);
      const response = await fetch(`${API_BASE_URL}/api/storage/buckets`, {
        method: 'POST',
        headers: {
          'x-api-key': actualApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ bucket: bucket_name })
      });

      const result = await handleApiResponse(response);
      
      return {
        content: [{
          type: "text",
          text: formatSuccessMessage('Bucket created', result)
        }]
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{
          type: "text",
          text: `Error creating bucket: ${errMsg}`
        }],
        isError: true
      };
    }
  }
);

// List storage buckets
server.tool(
  "list-buckets",
  "Lists all storage buckets",
  {},
  async () => {
    try {
      // This endpoint doesn't require authentication in the current implementation
      const response = await fetch(`${API_BASE_URL}/api/storage/buckets`, {
        method: 'GET',
        headers: {
          'x-api-key': getApiKey() // Still need API key for protected endpoint
        }
      });

      const result = await handleApiResponse(response);
      
      return {
        content: [{
          type: "text",
          text: formatSuccessMessage('Buckets retrieved', result)
        }]
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{
          type: "text",
          text: `Error listing buckets: ${errMsg}`
        }],
        isError: true
      };
    }
  }
);

// Delete storage bucket
server.tool(
  "delete-bucket",
  "Deletes a storage bucket",
  {
    api_key: z.string().optional().describe("API key for authentication (optional if provided via --api_key)"),
    bucket_name: z.string().describe("Name of the bucket to delete")
  },
  async ({ api_key, bucket_name }) => {
    try {
      const actualApiKey = getApiKey(api_key);
      const response = await fetch(`${API_BASE_URL}/api/storage/${bucket_name}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': actualApiKey
        }
      });

      const result = await handleApiResponse(response);
      
      return {
        content: [{
          type: "text",
          text: formatSuccessMessage('Bucket deleted', result)
        }]
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{
          type: "text",
          text: `Error deleting bucket: ${errMsg}`
        }],
        isError: true
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Insforge MCP server started");
}

main().catch(console.error);