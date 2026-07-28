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
        {
          label: 'Core concepts',
          items: [
            { label: 'Project 和时间线数据', slug: 'zh/concepts/project-timeline' },
            { label: '时间、帧率和素材时间', slug: 'zh/concepts/time-model' },
            { label: 'Transaction、revision 和撤销', slug: 'zh/concepts/transactions' },
            { label: '素材表示、缓存和生命周期', slug: 'zh/concepts/media-lifecycle' },
            { label: '预览和导出一致性', slug: 'zh/concepts/render-consistency' },
            { label: '引擎如何执行 Project', slug: 'zh/concepts/architecture' },
          ],
        },
        {
          label: 'Build an editor',
          items: [
            { label: '使用 Composition API 创作', slug: 'zh/guides/composition-api' },
            { label: '导入与管理媒体', slug: 'zh/guides/media-import' },
            { label: '时间线编辑', slug: 'zh/guides/timeline-editing' },
            { label: '实时预览与拖动播放头', slug: 'zh/guides/preview' },
            { label: '播放与音频', slug: 'zh/guides/player-audio' },
            { label: '把 SDK 接进剪辑器 UI', slug: 'zh/guides/editor-ui' },
            { label: '保存、恢复与素材重连', slug: 'zh/guides/persistence' },
            { label: 'Revision 持久化与扩展隔离', slug: 'zh/guides/durability-extensions' },
            { label: '从 WebAV 与 Diffusion Studio 迁移', slug: 'zh/guides/migration' },
            { label: '音频分析、静音移除与母带', slug: 'zh/guides/audio-mastering' },
            { label: '创建和安装 Material', slug: 'zh/guides/materials' },
          ],
        },
        {
          label: 'Export',
          items: [
            { label: '选择导出格式', slug: 'zh/export/overview' },
            { label: '导出 MP4 和 WebM', slug: 'zh/export/video' },
            { label: '导出静帧和 GIF', slug: 'zh/export/image-gif' },
            { label: '导出 WAV 音频', slug: 'zh/export/audio' },
            { label: '任务、进度和文件写入', slug: 'zh/export/jobs-sinks' },
            { label: '接入服务端导出', slug: 'zh/export/remote' },
          ],
        },
        {
          label: 'Production',
          items: [
            { label: '检查设备可用功能', slug: 'zh/production/capability-preflight' },
            { label: '浏览器兼容性与部署', slug: 'zh/production/compatibility' },
            { label: '预览性能和资源预算', slug: 'zh/production/performance' },
            { label: 'WebAV 与 Diffusion 同机基准', slug: 'zh/production/competitor-benchmark' },
            { label: '错误处理、恢复和日志', slug: 'zh/production/resilience' },
            { label: '上线前安全检查', slug: 'zh/production/security-deployment' },
            { label: '按现象排查问题', slug: 'zh/production/troubleshooting' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: '包和公开入口', slug: 'zh/reference/packages' },
            { label: 'Project v1 字段', slug: 'zh/reference/project-schema' },
            { label: 'Editing Commands 速查', slug: 'zh/reference/editing-commands' },
            { label: 'Export Profiles 速查', slug: 'zh/reference/export-profiles' },
            { label: 'Session 事件和统计', slug: 'zh/reference/events-stats' },
            { label: 'Diagnostic 错误码', slug: 'zh/reference/diagnostic-codes' },
            { label: '术语表', slug: 'zh/reference/glossary' },
            { label: 'Material Protocol v1 规范', slug: 'zh/reference/material-protocol-v1' },
            { label: 'Core Node Math 1.0', slug: 'zh/reference/core-node-math-v1' },
          ],
        },
        typeDocSidebarGroup,
        {
          label: 'Project',
          items: [
            { label: '当前版本状态', slug: 'zh/project/status' },
            { label: '维护仓库与准备发布', slug: 'zh/project/development' },
          ],
        },
      ],
    }),
  ],
});
