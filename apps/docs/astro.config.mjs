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
            { label: '从本地视频到 MP4', slug: 'start/getting-started' },
            { label: '安装与工程配置', slug: 'start/installation' },
            { label: '我需要安装哪些包', slug: 'start/packages' },
            { label: '运行参考编辑器', slug: 'start/reference-editor' },
            { label: '当前已经支持什么', slug: 'start/capabilities' },
          ],
        },
        {
          label: '核心概念',
          items: [
            { label: 'Project 和时间线数据', slug: 'concepts/project-timeline' },
            { label: '时间、帧率和素材时间', slug: 'concepts/time-model' },
            { label: 'Transaction、revision 和撤销', slug: 'concepts/transactions' },
            { label: '素材表示、缓存和生命周期', slug: 'concepts/media-lifecycle' },
            { label: '预览和导出一致性', slug: 'concepts/render-consistency' },
            { label: '引擎如何执行 Project', slug: 'concepts/architecture' },
          ],
        },
        {
          label: '构建剪辑器',
          items: [
            { label: '导入与管理媒体', slug: 'guides/media-import' },
            { label: '时间线编辑', slug: 'guides/timeline-editing' },
            { label: '实时预览与拖动播放头', slug: 'guides/preview' },
            { label: '播放与音频', slug: 'guides/player-audio' },
            { label: '把 SDK 接进剪辑器 UI', slug: 'guides/editor-ui' },
            { label: '保存、恢复与素材重连', slug: 'guides/persistence' },
            { label: '创建和安装 Material', slug: 'guides/materials' },
          ],
        },
        {
          label: '导出',
          items: [
            { label: '选择导出格式', slug: 'export/overview' },
            { label: '导出 MP4 和 WebM', slug: 'export/video' },
            { label: '导出静帧和 GIF', slug: 'export/image-gif' },
            { label: '导出 WAV 音频', slug: 'export/audio' },
            { label: '任务、进度和文件写入', slug: 'export/jobs-sinks' },
            { label: '接入服务端导出', slug: 'export/remote' },
          ],
        },
        {
          label: '生产环境',
          items: [
            { label: '检查设备可用功能', slug: 'production/capability-preflight' },
            { label: '浏览器兼容性与部署', slug: 'production/compatibility' },
            { label: '预览性能和资源预算', slug: 'production/performance' },
            { label: '错误处理、恢复和日志', slug: 'production/resilience' },
            { label: '上线前安全检查', slug: 'production/security-deployment' },
            { label: '按现象排查问题', slug: 'production/troubleshooting' },
          ],
        },
        {
          label: '参考',
          items: [
            { label: '包和公开入口', slug: 'reference/packages' },
            { label: 'Project v1 字段', slug: 'reference/project-schema' },
            { label: 'Editing Commands 速查', slug: 'reference/editing-commands' },
            { label: 'Export Profiles 速查', slug: 'reference/export-profiles' },
            { label: 'Session 事件和统计', slug: 'reference/events-stats' },
            { label: 'Diagnostic 错误码', slug: 'reference/diagnostic-codes' },
            { label: '术语表', slug: 'reference/glossary' },
            { label: 'Material Protocol v1 规范', slug: 'reference/material-protocol-v1' },
            { label: 'Core Node Math 1.0', slug: 'reference/core-node-math-v1' },
          ],
        },
        typeDocSidebarGroup,
        {
          label: '项目',
          items: [
            { label: '当前版本状态', slug: 'project/status' },
            { label: '维护仓库与准备发布', slug: 'project/development' },
          ],
        },
      ],
    }),
  ],
});
