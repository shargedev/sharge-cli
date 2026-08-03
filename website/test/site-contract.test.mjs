import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const agentPrompt =
  '请阅读 https://github.com/shargedev/sharge-cli 的 README，按照其中的「Agent 快速开始」完成 sharge CLI 和 Skills 的安装；发起登录，在需要浏览器授权时提醒我操作，授权完成后验证安装是否成功。';

test('首页提供完整的 Agent 与手动安装路径', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');

  assert.match(html, /<h1[^>]*>\s*把 Sharge 交给你的 Agent\s*<\/h1>/);
  assert.ok(html.includes(agentPrompt));
  assert.ok(html.includes('npm install --global @sharge/cli@latest'));
  assert.ok(html.includes('npx skills add shargedev/sharge-cli -y -g'));
  assert.ok(html.includes('sharge login'));
  assert.ok(html.includes('sharge auth status --json'));
});

test('公开文档可导航、搜索并回到 GitHub 原文', async () => {
  const html = await readFile(
    new URL('../dist/docs/getting-started/index.html', import.meta.url),
    'utf8'
  );

  assert.match(html, /<h1[^>]*[^>]*>快速开始<\/h1>/);
  assert.ok(html.includes('npm install --global @sharge/cli@latest'));
  assert.ok(
    html.includes(
      'https://github.com/shargedev/sharge-cli/edit/main/docs/getting-started.md'
    )
  );
  await access(new URL('../dist/pagefind/pagefind.js', import.meta.url));
});

test('所有公开文档路由存在，站内链接不暴露 Markdown 文件名', async () => {
  const routes = [
    'docs',
    'docs/getting-started',
    'docs/agent-guide',
    'docs/authentication',
    'docs/configuration',
    'docs/json-contract',
    'docs/errors',
    'docs/downloads',
    'docs/commands',
    'docs/commands/system',
    'docs/commands/notes',
    'docs/commands/calendar',
    'docs/commands/recordings',
    'docs/commands/diary',
  ];

  for (const route of routes) {
    const html = await readFile(
      new URL(`../dist/${route}/index.html`, import.meta.url),
      'utf8'
    );
    const internalMarkdownLinks = [...html.matchAll(/href="([^"]+\.md(?:#[^"]*)?)"/g)]
      .map((match) => match[1])
      .filter((href) => !href.startsWith('https://github.com/'));

    assert.deepEqual(internalMarkdownLinks, [], `${route} 仍包含 Markdown 站内链接`);
  }
});

test('首页完整呈现价值、能力、安全流程和恢复入口', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');

  for (const text of [
    'Agent-first',
    '行为可预测',
    '安全可控',
    'Notes',
    'Calendar',
    'Recordings',
    'Diary',
    '发现命令',
    'dry run',
    '人类确认',
    '结果恢复',
  ]) {
    assert.ok(html.includes(text), `首页缺少「${text}」`);
  }

  assert.match(html, /id="features"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /data-theme-toggle/);
  assert.match(html, /data-terminal-replay/);
  assert.ok(html.includes('https://www.npmjs.com/package/@sharge/cli'));

  const notFound = await readFile(new URL('../dist/404.html', import.meta.url), 'utf8');
  assert.ok(notFound.includes('页面没有找到'));
  assert.ok(notFound.includes('/sharge-cli/docs/'));
});

test('静态站输出完整 SEO 资产，且文档只有一个主标题', async () => {
  const home = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.ok(home.includes('rel="canonical"'));
  assert.ok(home.includes('property="og:image"'));
  assert.ok(home.includes('/sharge-cli/og.svg'));

  for (const route of ['docs', 'docs/getting-started', 'docs/commands/notes']) {
    const html = await readFile(
      new URL(`../dist/${route}/index.html`, import.meta.url),
      'utf8'
    );
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${route} 必须只有一个 h1`);
  }

  const robots = await readFile(new URL('../dist/robots.txt', import.meta.url), 'utf8');
  assert.ok(robots.includes('https://shargedev.github.io/sharge-cli/sitemap-index.xml'));
  await access(new URL('../dist/favicon.svg', import.meta.url));
  await access(new URL('../dist/og.svg', import.meta.url));
});

test('仓库公开入口与 Pages 发布配置指向静态站', async () => {
  const rootPackage = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8')
  );
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  const workflow = await readFile(
    new URL('../../.github/workflows/pages.yml', import.meta.url),
    'utf8'
  );

  assert.equal(rootPackage.homepage, 'https://shargedev.github.io/sharge-cli/');
  assert.ok(readme.includes('https://shargedev.github.io/sharge-cli/'));
  assert.ok(readme.includes('https://shargedev.github.io/sharge-cli/docs/'));
  assert.ok(workflow.includes('actions/deploy-pages'));
  assert.ok(workflow.includes('npm --prefix website ci'));
  assert.ok(workflow.includes('npm --prefix website test'));
  assert.deepEqual(rootPackage.files, ['dist', 'README.md', 'install.sh']);
});

test('latest 文档显示构建版本并链接 Changelog', async () => {
  const html = await readFile(
    new URL('../dist/docs/getting-started/index.html', import.meta.url),
    'utf8'
  );

  assert.ok(html.includes('v0.2.1'));
  assert.ok(html.includes('https://github.com/shargedev/sharge-cli/blob/main/CHANGELOG.md'));
});
