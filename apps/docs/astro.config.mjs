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
        root: { label: '简体中文', lang: 'zh-CN' },
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
          label: '开始使用',
          items: [
            { label: '认识 AelionSDK', slug: '' },
            { label: '快速开始', slug: 'start/getting-started' },
            { label: '安装与工程配置', slug: 'start/installation' },
            { label: '选择包与接入层级', slug: 'start/packages' },
            { label: '运行参考编辑器', slug: 'start/reference-editor' },
            { label: '能力全景', slug: 'start/capabilities' },
          ],
        },
        {
          label: '核心概念',
          items: [
            { label: 'Project 与 Timeline', slug: 'concepts/project-timeline' },
            { label: '时间与帧', slug: 'concepts/time-model' },
            { label: '事务、历史与交互编辑', slug: 'concepts/transactions' },
            { label: '媒体表示与生命周期', slug: 'concepts/media-lifecycle' },
            { label: '预览与导出一致性', slug: 'concepts/render-consistency' },
            { label: '架构与执行模型', slug: 'concepts/architecture' },
          ],
        },
        {
          label: '构建剪辑器',
          items: [
            { label: '导入与管理媒体', slug: 'guides/media-import' },
            { label: '时间线编辑', slug: 'guides/timeline-editing' },
            { label: '实时预览与 Scrub', slug: 'guides/preview' },
            { label: '播放与音频', slug: 'guides/player-audio' },
            { label: '剪辑 UI 集成', slug: 'guides/editor-ui' },
            { label: '保存、恢复与迁移', slug: 'guides/persistence' },
            { label: 'Material 创作与接入', slug: 'guides/materials' },
          ],
        },
        {
          label: '导出',
          items: [
            { label: '导出概览', slug: 'export/overview' },
            { label: 'WebM 与 H.264 MP4', slug: 'export/video' },
            { label: '静帧与 GIF', slug: 'export/image-gif' },
            { label: 'WAV 音频', slug: 'export/audio' },
            { label: '任务、进度与 Sink', slug: 'export/jobs-sinks' },
            { label: '远程导出', slug: 'export/remote' },
          ],
        },
        {
          label: '生产环境',
          items: [
            { label: '能力探测与 Preflight', slug: 'production/capability-preflight' },
            { label: '兼容性与部署', slug: 'production/compatibility' },
            { label: '性能与资源预算', slug: 'production/performance' },
            { label: '错误、恢复与可观测性', slug: 'production/resilience' },
            { label: '安全与部署清单', slug: 'production/security-deployment' },
            { label: '故障排查', slug: 'production/troubleshooting' },
          ],
        },
        {
          label: '参考',
          items: [
            { label: '包与入口', slug: 'reference/packages' },
            { label: 'Project Schema', slug: 'reference/project-schema' },
            { label: 'Editing Commands', slug: 'reference/editing-commands' },
            { label: 'Export Profiles', slug: 'reference/export-profiles' },
            { label: '事件与统计', slug: 'reference/events-stats' },
            { label: 'Diagnostic Codes', slug: 'reference/diagnostic-codes' },
            { label: '术语表', slug: 'reference/glossary' },
            { label: 'Material Protocol v1', slug: 'reference/material-protocol-v1' },
            { label: 'Core Node Math 1.0', slug: 'reference/core-node-math-v1' },
          ],
        },
        typeDocSidebarGroup,
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
