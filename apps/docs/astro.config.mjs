import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

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
        root: { label: '简体中文', lang: 'zh-CN' },
      },
      customCss: ['./src/styles/custom.css'],
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
          label: '开始',
          items: [
            { label: '认识 AelionSDK', slug: '' },
            { label: '快速开始', slug: 'start/getting-started' },
            { label: '能力全景', slug: 'start/capabilities' },
          ],
        },
        {
          label: '核心概念',
          items: [{ label: '架构与执行模型', slug: 'concepts/architecture' }],
        },
        {
          label: '扩展与集成',
          items: [{ label: 'Material 创作与接入', slug: 'guides/materials' }],
        },
        {
          label: '生产环境',
          items: [{ label: '兼容性与部署', slug: 'production/compatibility' }],
        },
        {
          label: '参考',
          items: [
            { label: 'Diagnostic Codes', slug: 'reference/diagnostic-codes' },
            { label: 'Material Protocol v1', slug: 'reference/material-protocol-v1' },
            { label: 'Core Node Math 1.0', slug: 'reference/core-node-math-v1' },
          ],
        },
        {
          label: '项目',
          items: [
            { label: '当前状态', slug: 'project/status' },
            { label: '开发与发布', slug: 'project/development' },
          ],
        },
      ],
    }),
  ],
});
