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
        en: {
          label: 'English',
          lang: 'en',
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
          translations: { en: 'Get started' },
          items: [
            { slug: 'docs' },
            { slug: 'docs/getting-started' },
          ],
        },
        {
          label: 'Agent',
          items: [{ slug: 'docs/agent-guide' }],
        },
        {
          label: '核心概念',
          translations: { en: 'Core concepts' },
          items: [
            { slug: 'docs/authentication' },
            { slug: 'docs/configuration' },
            { slug: 'docs/json-contract' },
            { slug: 'docs/errors' },
            { slug: 'docs/downloads' },
          ],
        },
        {
          label: '命令参考',
          translations: { en: 'Command reference' },
          items: [
            { slug: 'docs/commands' },
            { slug: 'docs/commands/system' },
            { slug: 'docs/commands/notes' },
            { slug: 'docs/commands/calendar' },
            { slug: 'docs/commands/recordings' },
            { slug: 'docs/commands/diary' },
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
