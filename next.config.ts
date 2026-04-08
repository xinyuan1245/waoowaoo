import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

function readAllowedDevOrigins(): string[] {
  const origins = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ])

  const configured = process.env.NEXTAUTH_URL?.trim()
  if (configured) {
    origins.add(configured.replace(/\/+$/, ''))
  }

  return Array.from(origins)
}

const nextConfig: NextConfig = {
  // 已删除 ignoreBuildErrors / ignoreDuringBuilds，构建保持严格门禁
  // Next 15 的 allowedDevOrigins 是顶层配置，不属于 experimental
  allowedDevOrigins: readAllowedDevOrigins(),
};

export default withNextIntl(nextConfig);
