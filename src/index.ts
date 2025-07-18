#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from 'node-fetch';
import { program } from "commander";
import { handleApiResponse, formatSuccessMessage } from './response-handler.js';

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

// Helper function to fetch documentation from backend
const fetchDocumentation = async (docType: string): Promise<string> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/docs/${docType}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch documentation: ${response.statusText}`);
    }

    const result = await response.json() as any;
    if (result.success && result.data?.content) {
      return result.data.content;
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
      nullable: z.boolean().describe("Whether the column can be null")
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
      default_value: z.string().optional().describe("Default value for the column")
    })).optional().describe("Columns to add to the table"),
    drop_columns: z.array(z.string()).optional().describe("Names of columns to drop from the table"),
    rename_columns: z.record(z.string()).optional().describe("Object mapping old column names to new names")
  },
  async ({ api_key, table_name, add_columns, drop_columns, rename_columns }) => {
    try {
      const actualApiKey = getApiKey(api_key);
      const body: any = {};
      if (add_columns) body.add_columns = add_columns;
      if (drop_columns) body.drop_columns = drop_columns;
      if (rename_columns) body.rename_columns = rename_columns;

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