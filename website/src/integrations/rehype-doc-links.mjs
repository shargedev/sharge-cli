import path from 'node:path';

const markdownExtension = /\.(md|mdx)$/i;

function routeForMarkdown(relativePath) {
  const withoutExtension = relativePath.replace(markdownExtension, '');
  const withoutReadme = withoutExtension
    .replace(/(^|\/)README$/i, '$1')
    .replace(/\/$/, '');

  return withoutReadme ? `/docs/${withoutReadme}/` : '/docs/';
}

function visitLinks(node, rewrite) {
  if (node?.type === 'element' && node.tagName === 'a') {
    const href = node.properties?.href;
    if (typeof href === 'string') {
      node.properties.href = rewrite(href);
    }
  }

  for (const child of node?.children ?? []) {
    visitLinks(child, rewrite);
  }
}

function removeSourceTitle(node) {
  const titleIndex = node.children?.findIndex(
    (child) => child?.type === 'element' && child.tagName === 'h1'
  );
  if (titleIndex >= 0) {
    node.children.splice(titleIndex, 1);
    return true;
  }

  for (const child of node.children ?? []) {
    if (removeSourceTitle(child)) return true;
  }
  return false;
}

export default function rehypeDocLinks({ base, docsRoot }) {
  const normalizedBase = `/${base.replace(/^\/+|\/+$/g, '')}`;
  const normalizedDocsRoot = path.resolve(docsRoot);

  return (tree, file) => {
    const sourcePath = path.resolve(file.path ?? '');
    if (!sourcePath.startsWith(`${normalizedDocsRoot}${path.sep}`)) return;

    // Starlight renders the frontmatter title. Root docs retain their Markdown H1 for
    // readable GitHub source, so remove only that duplicate in the website pipeline.
    removeSourceTitle(tree);
    visitLinks(tree, (href) => {
      if (/^(?:[a-z]+:|\/|#)/i.test(href)) return href;

      const match = href.match(/^([^?#]+)([?#].*)?$/);
      if (!match || !markdownExtension.test(match[1])) return href;

      const targetPath = path.resolve(path.dirname(sourcePath), match[1]);
      const relativeTarget = path.relative(normalizedDocsRoot, targetPath);
      if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) return href;

      return `${normalizedBase}${routeForMarkdown(relativeTarget)}${match[2] ?? ''}`;
    });
  };
}

export function remarkRemoveDocTitle({ docsRoot }) {
  const normalizedDocsRoot = path.resolve(docsRoot);

  return (tree, file) => {
    const sourcePath = path.resolve(file.path ?? '');
    if (!sourcePath.startsWith(`${normalizedDocsRoot}${path.sep}`)) return;

    const titleIndex = tree.children?.findIndex(
      (node) => node?.type === 'heading' && node.depth === 1
    );
    if (titleIndex >= 0) tree.children.splice(titleIndex, 1);
  };
}
