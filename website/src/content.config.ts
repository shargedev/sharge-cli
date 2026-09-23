import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

const docsRoot = new URL('../../docs/', import.meta.url);

const generateDocsId = ({ entry }: { entry: string }) => {
  const pathWithoutExtension = entry.replace(/\.(md|mdx)$/i, '');
  const english = pathWithoutExtension.endsWith('.en');
  const pathWithoutReadme = pathWithoutExtension
    .replace(/\.en$/, '')
    .replace(/(^|\/)README$/i, '$1')
    .replace(/\/$/, '');

  const docsId = pathWithoutReadme ? `docs/${pathWithoutReadme}` : 'docs';
  return english ? `en/${docsId}` : docsId;
};

export const collections = {
  docs: defineCollection({
    loader: glob({
      base: docsRoot,
      pattern: '**/*.{md,mdx}',
      generateId: generateDocsId,
    }),
    schema: docsSchema(),
  }),
};
