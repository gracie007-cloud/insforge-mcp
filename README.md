<div align="center">
  <a href="https://insforge.dev">
    <img src="banner.png" alt="Insforge Banner">
  </a>
</div>

# Insforge MCP Server

Model Context Protocol server for [Insforge](https://github.com/InsForge/insforge).

## 📖 Documentation

Please visit the [main Insforge repository](https://github.com/InsForge/insforge) for:

- Installation and setup instructions
- Configuration guide
- Available tools and usage examples
- API documentation
- Contributing guidelines

## 🚀 Quick Start

### Automated Installation (Recommended)

Use the InsForge installer to automatically configure MCP for your client:

```bash
# Claude Code
npx @insforge/install --client claude-code --env API_KEY=your_api_key --env API_BASE_URL=http://localhost:7130

# Cursor
npx @insforge/install --client cursor --env API_KEY=your_api_key --env API_BASE_URL=http://localhost:7130

# Windsurf
npx @insforge/install --client windsurf --env API_KEY=your_api_key --env API_BASE_URL=http://localhost:7130

# Cline
npx @insforge/install --client cline --env API_KEY=your_api_key --env API_BASE_URL=http://localhost:7130

# Roo Code
npx @insforge/install --client roocode --env API_KEY=your_api_key --env API_BASE_URL=http://localhost:7130
# Trae
npx @insforge/install --client trae --env API_KEY=your_api_key --env API_BASE_URL=http://localhost:7130

# Install dev version for testing
npx @insforge/install --client cursor --env API_KEY=your_api_key --env API_BASE_URL=http://localhost:7130 --dev
```

Replace:
- `your_api_key` with your InsForge API key
- `http://localhost:7130` with your InsForge instance URL (optional, defaults to localhost:7130)

### Manual Installation

If you prefer to manually configure your MCP client, add this to your MCP settings file:

```json
{
  "mcpServers": {
    "insforge": {
      "command": "npx",
      "args": [
        "-y",
        "@insforge/mcp@latest"
      ],
      "env": {
        "API_KEY": "your_api_key",
        "API_BASE_URL": "http://localhost:7130"
      }
    }
  }
}
```

For detailed setup instructions, see the [Insforge Documentation](https://docs.insforge.dev).

## 📄 License

Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

---

Part of the [Insforge](https://github.com/InsForge/insforge) project.