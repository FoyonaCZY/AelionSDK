import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';

export default defineConfig({
  site: 'https://foyonaczy.github.io',
  base: '/AelionSDK',
  integrations: [
    starlight({
      title: 'AelionSDK',
      description: 'Browser-first 视频编辑、实时预览与渲染 SDK',
      favicon: '/favicon.svg',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        zh: { label: '简体中文', lang: 'zh-CN' },
      },
      customCss: ['./src/styles/custom.css'],
      plugins: [
        starlightTypeDoc({
          entryPoints: ['../../packages/*'],
          tsconfig: '../../tsconfig.json',
          output: 'api',
          pagination: true,
          sidebar: { label: 'API Reference', collapsed: true },
          typeDoc: {
            entryPointStrategy: 'packages',
            entryFileName: 'overview',
            packageOptions: {
              entryPoints: ['src/index.ts'],
              entryFileName: 'overview',
              // Existing declarations are tracked by check-api-doc-coverage.mjs.
              // Keep TypeDoc generation non-blocking while that baseline is reduced.
              validation: { notDocumented: false, notExported: false },
            },
            categorizeByGroup: true,
            sort: ['source-order'],
            validation: { notDocumented: false, notExported: false },
          },
        }),
      ],
      editLink: {
        baseUrl: 'https://github.com/FoyonaCZY/AelionSDK/edit/main/apps/docs/',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/FoyonaCZY/AelionSDK',
        },
      ],
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'What is AelionSDK?', slug: '' },
            { label: 'From a local video to MP4', slug: 'start/getting-started' },
            { label: 'Install and configure', slug: 'start/installation' },
            { label: 'Choose packages', slug: 'start/packages' },
            { label: 'Run the reference editor', slug: 'start/reference-editor' },
            { label: 'Capabilities and limits', slug: 'start/capabilities' },
          ],
        },
        typeDocSidebarGroup,
        { label: '中文完整文档', link: 'zh/' },
      ],
    }),
  ],
});
