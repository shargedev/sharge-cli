import tailwindcss from '@tailwindcss/vite';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import { defineConfig } from 'astro/config';
import rehypeDocLinks, { remarkRemoveDocTitle } from './src/integrations/rehype-doc-links.mjs';

const docsRoot = new URL('../docs/', import.meta.url);
const base = '/sharge-cli';

export default defineConfig({
  site: 'https://shargedev.github.io',
  base,
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  markdown: {
    processor: unified({
      remarkPlugins: [[remarkRemoveDocTitle, { docsRoot: docsRoot.pathname }]],
      rehypePlugins: [
        [
          rehypeDocLinks,
          {
            base,
            docsRoot: docsRoot.pathname,
          },
        ],
      ],
    }),
  },
  integrations: [
    starlight({
      title: 'sharge CLI',
      description: 'Sharge Open Platform 官方 Agent-first CLI 文档',
      head: [
        { tag: 'link', attrs: { rel: 'icon', href: `${base}/favicon.svg`, type: 'image/svg+xml' } },
        { tag: 'meta', attrs: { property: 'og:image', content: `https://shargedev.github.io${base}/og.svg` } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
      ],
      logo: {
        src: './src/assets/logo.svg',
        alt: 'SHARGE loomos',
        replacesTitle: false,
      },
      locales: {
        root: {
          label: '简体中文',
          lang: 'zh-CN',
        },
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/shargedev/sharge-cli',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/shargedev/sharge-cli/edit/main/website/',
      },
      expressiveCode: {
        themes: ['starlight-dark'],
      },
      sidebar: [
        {
          label: '开始使用',
          items: [
            { label: '文档概览', slug: 'docs' },
            { label: '快速开始', slug: 'docs/getting-started' },
          ],
        },
        {
          label: 'Agent',
          items: [{ label: 'Agent 使用指南', slug: 'docs/agent-guide' }],
        },
        {
          label: '核心概念',
          items: [
            { label: '鉴权', slug: 'docs/authentication' },
            { label: '配置', slug: 'docs/configuration' },
            { label: 'JSON 契约', slug: 'docs/json-contract' },
            { label: '错误与退出码', slug: 'docs/errors' },
            { label: '下载', slug: 'docs/downloads' },
          ],
        },
        {
          label: '命令参考',
          items: [
            { label: '命令概览', slug: 'docs/commands' },
            { label: '系统命令', slug: 'docs/commands/system' },
            { label: 'Notes', slug: 'docs/commands/notes' },
            { label: 'Calendar', slug: 'docs/commands/calendar' },
            { label: 'Recordings', slug: 'docs/commands/recordings' },
            { label: 'Diary', slug: 'docs/commands/diary' },
          ],
        },
      ],
      customCss: ['./src/styles/starlight.css'],
      components: {
        SiteTitle: './src/components/StarlightSiteTitle.astro',
        Footer: './src/components/DocsFooter.astro',
      },
      pagefind: true,
      credits: false,
      disable404Route: true,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
