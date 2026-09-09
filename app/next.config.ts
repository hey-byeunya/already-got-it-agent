import type { NextConfig } from 'next';

const config: NextConfig = {
  // 엔진과 MCP 클라이언트는 Node 런타임에서만 돈다. 번들에 끌어넣지 않는다.
  serverExternalPackages: [
    'already-got-it-ops-agent',
    'already-got-it-ops-mcp',
    '@anthropic-ai/claude-agent-sdk',
  ],
};

export default config;
