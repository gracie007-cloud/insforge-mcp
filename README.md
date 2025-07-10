# Insforge MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)](https://nodejs.org/)

MCP (Model Context Protocol) server for [Insforge](https://github.com/InsForge/insforge) - an open-source backend-as-a-service platform.

## Overview

The Insforge MCP Server enables AI agents to interact with Insforge backends through the Model Context Protocol. It provides a comprehensive set of tools for database management, authentication, storage operations, and backend configuration.

## Features

- 🗄️ **Database Management**: Create, modify, and query PostgreSQL tables with automatic schema management
- 🔐 **Authentication API**: Manage users, API keys, and JWT tokens
- 📁 **Storage Operations**: Handle file uploads and bucket management
- 📚 **Documentation Access**: Built-in access to API documentation
- 🤖 **AI-Optimized**: Designed for seamless integration with AI agents and LLMs

## Prerequisites

- Node.js 16.0.0 or higher
- An Insforge instance running (local or remote)
- API key from your Insforge instance

## Installation

```bash
# Clone the repository
git clone https://github.com/InsForge/insforge-mcp.git
cd insforge-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

## Configuration

### API Key

You can provide your Insforge API key in three ways:

1. **Command line argument**:
   ```bash
   node dist/index.js --api_key ik_your_api_key_here
   ```

2. **Environment variable**:
   ```bash
   export API_KEY=ik_your_api_key_here
   node dist/index.js
   ```

3. **Per-tool basis**: Include `api_key` in individual tool calls

### API Base URL

By default, the MCP server connects to `http://localhost:3000`. To use a different Insforge instance:

```bash
export API_BASE_URL=https://your-insforge-instance.com
node dist/index.js
```

## Usage

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

### With Claude Desktop

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "insforge": {
      "command": "node",
      "args": ["/path/to/insforge-mcp/dist/index.js", "--api_key", "ik_your_api_key_here"],
      "env": {
        "API_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Available Tools

### Documentation Tools

- **`get-instructions`**: Retrieves the latest Insforge documentation and guidelines
- **`get-db-api`**: Returns database API documentation including CRUD operations
- **`get-auth-api`**: Returns authentication API documentation
- **`get-storage-api`**: Returns file storage API documentation

### Database Tools

- **`create-table`**: Create a new table with explicit schema definition
  ```json
  {
    "collection_name": "users",
    "columns": [
      {"name": "email", "type": "TEXT", "nullable": false},
      {"name": "age", "type": "INTEGER", "nullable": true}
    ]
  }
  ```

- **`delete-table`**: Permanently delete a table and all its data
- **`modify-table`**: Add, drop, or rename columns in existing tables
- **`get-table-schema`**: Retrieve the schema of a specific table
- **`get-backend-metadata`**: Get comprehensive backend metadata and statistics

### Storage Tools

- **`create-bucket`**: Create a new storage bucket
- **`list-buckets`**: List all available storage buckets
- **`delete-bucket`**: Delete a storage bucket

## Examples

### Creating a Table

```typescript
// Tool: create-table
{
  "collection_name": "products",
  "columns": [
    {"name": "name", "type": "TEXT", "nullable": false},
    {"name": "price", "type": "REAL", "nullable": false},
    {"name": "stock", "type": "INTEGER", "nullable": false},
    {"name": "description", "type": "TEXT", "nullable": true}
  ]
}
```

### Modifying a Table

```typescript
// Tool: modify-table
{
  "collection_name": "products",
  "add_columns": [
    {"name": "category", "type": "TEXT", "nullable": true}
  ],
  "rename_columns": {
    "stock": "quantity"
  }
}
```

## Development

### Project Structure

```
insforge-mcp/
├── src/
│   ├── index.ts          # Main MCP server implementation
│   └── response-handler.ts # API response handling utilities
├── package.json
├── tsconfig.json
└── README.md
```

### Running Tests

```bash
npm test
```

### Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

## Error Handling

The MCP server provides detailed error messages for common issues:

- **Missing API Key**: Ensure you've provided a valid API key
- **Connection Errors**: Verify your Insforge instance is running and accessible
- **Permission Errors**: Check that your API key has the necessary permissions
- **Schema Validation**: Ensure column types are valid (TEXT, INTEGER, REAL, BLOB)

## Security

- API keys are never logged or exposed in error messages
- All communication with Insforge uses secure HTTPS in production
- Supports row-level security (RLS) for multi-tenant applications

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- 📖 [Documentation](https://github.com/InsForge/insforge/docs)
- 🐛 [Issue Tracker](https://github.com/InsForge/insforge-mcp/issues)
- 💬 [Discussions](https://github.com/InsForge/insforge/discussions)

## Related Projects

- [Insforge](https://github.com/InsForge/insforge) - The main backend-as-a-service platform
- [Model Context Protocol](https://modelcontextprotocol.io/) - The protocol specification

---

Built with ❤️ by the Insforge team