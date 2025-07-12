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

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

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
  "Retrieves the latest Insforge OSS documentation, containing guidelines for AI agents to automatically set up and manage backend components",
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
  "Create a new collection/table with explicit schema definition",
  {
    api_key: z.string().optional().describe("API key for authentication (optional if provided via --api_key)"),
    collection_name: z.string().describe("Name of the collection to create"),
    columns: z.array(z.object({
      name: z.string().describe("Column name"),
      type: z.string().describe("Column type (e.g., string, integer, float, boolean, datetime, uuid, json)"),
      nullable: z.boolean().describe("Whether the column can be null")
    })).describe("Array of column definitions")
  },
  async ({ api_key, collection_name, columns }) => {
    try {
      const actualApiKey = getApiKey(api_key);
      const response = await fetch(`${API_BASE_URL}/api/collections`, {
        method: 'POST',
        headers: {
          'x-api-key': actualApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          collection_name,
          columns
        })
      });

      const result = await handleApiResponse(response);
      
      return {
        content: [{
          type: "text",
          text: formatSuccessMessage('Collection created', result)
        }]
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{
          type: "text",
          text: `Error creating collection: ${errMsg}`
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
    collection_name: z.string().describe("Name of the collection to delete")
  },
  async ({ api_key, collection_name }) => {
    try {
      const actualApiKey = getApiKey(api_key);
      const response = await fetch(`${API_BASE_URL}/api/collections/${collection_name}`, {
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
          text: formatSuccessMessage('Collection deleted', result)
        }]
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{
          type: "text",
          text: `Error deleting collection: ${errMsg}`
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
    collection_name: z.string().describe("Name of the collection to modify"),
    add_columns: z.array(z.object({
      name: z.string().describe("Column name"),
      type: z.string().describe("Column type (string, integer, float, boolean, datetime, uuid, json)"),
      nullable: z.boolean().optional().describe("Whether the column allows NULL values"),
      default_value: z.string().optional().describe("Default value for the column")
    })).optional().describe("Columns to add to the collection"),
    drop_columns: z.array(z.string()).optional().describe("Names of columns to drop from the collection"),
    rename_columns: z.record(z.string()).optional().describe("Object mapping old column names to new names")
  },
  async ({ api_key, collection_name, add_columns, drop_columns, rename_columns }) => {
    try {
      const actualApiKey = getApiKey(api_key);
      const body: any = {};
      if (add_columns) body.add_columns = add_columns;
      if (drop_columns) body.drop_columns = drop_columns;
      if (rename_columns) body.rename_columns = rename_columns;

      const response = await fetch(`${API_BASE_URL}/api/collections/${collection_name}`, {
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
          text: formatSuccessMessage('Collection modified', result)
        }]
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{
          type: "text",
          text: `Error modifying collection: ${errMsg}`
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
    collection_name: z.string().describe("Name of the collection")
  },
  async ({ api_key, collection_name }) => {
    try {
      const actualApiKey = getApiKey(api_key);
      const response = await fetch(`${API_BASE_URL}/api/collections/${collection_name}/schema`, {
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