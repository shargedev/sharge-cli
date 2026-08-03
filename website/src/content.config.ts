import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

const docsRoot = new URL('../../docs/', import.meta.url);

const generateDocsId = ({ entry }: { entry: string }) => {
  const pathWithoutExtension = entry.replace(/\.(md|mdx)$/i, '');
  const pathWithoutReadme = pathWithoutExtension
    .replace(/(^|\/)README$/i, '$1')
    .replace(/\/$/, '');

  return pathWithoutReadme ? `docs/${pathWithoutReadme}` : 'docs';
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
