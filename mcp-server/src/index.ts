import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WrightTestApi } from './api.js';
import { registerWrightTestTools } from './tools.js';
import { registerBrowserTools } from './browser-tools.js';

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const api = new WrightTestApi(
    requiredEnvironment('WRIGHTTEST_URL'),
    requiredEnvironment('WRIGHTTEST_API_TOKEN')
  );
  const server = new McpServer({ name: 'wrighttest', version: '0.1.0' }, { maxToolInputElements: 10_000 });
  registerWrightTestTools(server, api);
  registerBrowserTools(server, api);
  await server.connect(new StdioServerTransport());
}

main().catch(() => {
  // Keep stdout reserved for MCP JSON-RPC messages and never log credentials.
  console.error('WrightTest MCP server failed to start. Check WRIGHTTEST_URL and WRIGHTTEST_API_TOKEN.');
  process.exitCode = 1;
});
