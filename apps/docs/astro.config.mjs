import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';

export default defineConfig({
  site: 'https://foyonaczy.github.io',
  base: '/AelionSDK',
  integrations: [
    starlight({
      title: 'AelionSDK',
      description: 'Browser-first video editing, real-time preview, playback, and export SDK',
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
          translations: { 'zh-CN': '开始使用' },
          items: [
            { slug: '' },
            { slug: 'start/getting-started' },
            { slug: 'start/installation' },
            { slug: 'start/packages' },
            { slug: 'start/reference-editor' },
            { slug: 'start/capabilities' },
          ],
        },
        {
          label: 'Concepts',
          translations: { 'zh-CN': '核心概念' },
          items: [
            { slug: 'concepts/architecture' },
            { slug: 'concepts/project-timeline' },
            { slug: 'concepts/time-model' },
            { slug: 'concepts/transactions' },
            { slug: 'concepts/media-lifecycle' },
            { slug: 'concepts/render-consistency' },
          ],
        },
        {
          label: 'Guides',
          translations: { 'zh-CN': '开发指南' },
          items: [
            { slug: 'guides/composition-api' },
            { slug: 'guides/media-import' },
            { slug: 'guides/editor-ui' },
            { slug: 'guides/timeline-editing' },
            { slug: 'guides/preview' },
            { slug: 'guides/player-audio' },
            { slug: 'guides/audio-mastering' },
            { slug: 'guides/materials' },
            { slug: 'guides/persistence' },
            { slug: 'guides/durability-extensions' },
            { slug: 'guides/migration' },
          ],
        },
        {
          label: 'Export',
          translations: { 'zh-CN': '导出' },
          items: [
            { slug: 'export/overview' },
            { slug: 'export/video' },
            { slug: 'export/audio' },
            { slug: 'export/image-gif' },
            { slug: 'export/jobs-sinks' },
            { slug: 'export/remote' },
          ],
        },
        {
          label: 'Production',
          translations: { 'zh-CN': '生产环境' },
          items: [
            { slug: 'production/capability-preflight' },
            { slug: 'production/compatibility' },
            { slug: 'production/performance' },
            { slug: 'production/resilience' },
            { slug: 'production/security-deployment' },
            { slug: 'production/troubleshooting' },
            { slug: 'production/competitor-benchmark' },
          ],
        },
        {
          label: 'Reference',
          translations: { 'zh-CN': '参考' },
          items: [
            { slug: 'reference/packages' },
            { slug: 'reference/project-schema' },
            { slug: 'reference/editing-commands' },
            { slug: 'reference/events-stats' },
            { slug: 'reference/export-profiles' },
            { slug: 'reference/diagnostic-codes' },
            { slug: 'reference/material-protocol-v1' },
            { slug: 'reference/core-node-math-v1' },
            { slug: 'reference/glossary' },
          ],
        },
        {
          label: 'Project',
          translations: { 'zh-CN': '项目' },
          items: [{ slug: 'project/status' }, { slug: 'project/development' }],
        },
        typeDocSidebarGroup,
      ],
    }),
  ],
});
