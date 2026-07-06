import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/material-icon-theme/icons/*.svg',
          dest: 'file-icons',
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api/agent/ws': {
        target: 'http://localhost:8081',
        changeOrigin: true,
        ws: true,
      },
      '/api/pty/ws': {
        target: 'http://localhost:8081',
        changeOrigin: true,
        ws: true,
      },
      '/api': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          const parts = id.split('node_modules/')[1]?.split('/') || []
          const pkg = parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]

          if (
            pkg === 'mermaid' ||
            pkg === '@mermaid-js/parser' ||
            pkg === '@braintree/sanitize-url' ||
            pkg?.startsWith('@iconify/') ||
            [
              '@upsetjs/venn.js',
              'cytoscape',
              'cytoscape-cose-bilkent',
              'cytoscape-fcose',
              'cose-base',
              'd3',
              'd3-sankey',
              'dagre-d3-es',
              'dayjs',
              'dompurify',
              'duck',
              'es-toolkit',
              'hachure-fill',
              'katex',
              'khroma',
              'layout-base',
              'lodash-es',
              'marked',
              'path-data-parser',
              'points-on-curve',
              'points-on-path',
              'roughjs',
              'stylis',
              'ts-dedent',
            ].includes(pkg)
          ) {
            return 'vendor-mermaid'
          }

          if (['react', 'react-dom', 'scheduler', 'react-is', 'prop-types', 'use-sync-external-store'].includes(pkg)) return 'vendor-react'
          if (pkg === 'zustand') return 'vendor-state'
          if (pkg === 'lucide-react') return 'vendor-icons'
          if (pkg === 'i18next' || pkg === 'react-i18next') return 'vendor-i18n'
          if (pkg === 'lodash') return 'vendor-lodash'
          if (
            pkg === 'recharts' ||
            pkg === 'victory-vendor' ||
            pkg?.startsWith('d3-') ||
            ['react-smooth', 'recharts-scale', 'decimal.js-light', 'eventemitter3', 'fast-equals', 'internmap', 'clsx', 'tiny-invariant', '@babel/runtime'].includes(pkg)
          ) {
            return 'vendor-charts'
          }
          if (
            pkg?.startsWith('@codemirror/') ||
            pkg === '@uiw/react-codemirror' ||
            pkg === '@uiw/codemirror-extensions-basic-setup' ||
            pkg?.startsWith('@lezer/') ||
            ['@marijn/find-cluster-break', 'style-mod', 'w3c-keyname', 'crelt'].includes(pkg)
          ) {
            return 'vendor-editor'
          }
          if (pkg === 'highlight.js') return 'vendor-highlight'
          if (pkg === 'xlsx' || pkg === 'base64-js') return 'vendor-xlsx'
          if (['mammoth', 'underscore', 'bluebird', 'xmlbuilder', '@xmldom/xmldom', 'lop', 'dingbat-to-unicode', 'option'].includes(pkg)) return 'vendor-docx'
          if (pkg === 'jszip') return 'vendor-zip'
          if (pkg === 'papaparse') return 'vendor-csv'
          if (
            pkg === 'react-markdown' ||
            pkg?.startsWith('rehype') ||
            pkg?.startsWith('remark') ||
            pkg?.startsWith('micromark') ||
            pkg === 'unified' ||
            pkg?.startsWith('hast') ||
            pkg?.startsWith('mdast') ||
            pkg?.startsWith('unist') ||
            pkg?.startsWith('vfile') ||
            [
              '@ungap/structured-clone',
              'bail',
              'ccount',
              'comma-separated-tokens',
              'decode-named-character-reference',
              'devlop',
              'escape-string-regexp',
              'estree-util-is-identifier-name',
              'extend',
              'html-url-attributes',
              'inline-style-parser',
              'is-plain-obj',
              'longest-streak',
              'lowlight',
              'markdown-table',
              'property-information',
              'space-separated-tokens',
              'style-to-js',
              'style-to-object',
              'trim-lines',
              'trough',
            ].includes(pkg)
          ) {
            return 'vendor-markdown'
          }
          if (pkg?.startsWith('@xterm/')) return 'vendor-terminal'
          if (pkg === 'framer-motion' || pkg === 'motion-utils' || pkg === 'motion-dom') return 'vendor-motion'
          if (pkg === 'echarts' || pkg === 'zrender' || pkg === 'tslib') return 'vendor-echarts'
          if (pkg === 'pptx-preview' || pkg === 'pptxjs' || pkg === 'jquery' || pkg === 'uuid') return 'vendor-pptx'
          if (
            pkg?.startsWith('@excalidraw/') ||
            [
              'jotai',
              'jotai-scope',
              'perfect-freehand',
              'pica',
              'pako',
              'open-color',
              'browser-fs-access',
              'canvas-roundrect-polyfill',
              'fractional-indexing',
              'fuzzy',
              'image-blob-reduce',
              'lodash.throttle',
              'lodash.debounce',
              'png-chunk-text',
              'png-chunks-encode',
              'png-chunks-extract',
              'pwacompat',
              'es6-promise-pool',
              'excalidraw-animate',
              'nanoid',
            ].includes(pkg)
          ) {
            return 'vendor-excalidraw'
          }

          return 'vendor-misc'
        },
      },
    },
    // echarts (1MB) is pulled in only by pptx-preview, which is
    // dynamic-imported in RichFilePreview.jsx and never loaded on the
    // critical path. Raising the warning ceiling so the lazy chunk
    // doesn't drown out real bloat warnings on eager chunks.
    chunkSizeWarningLimit: 1100,
  },
})
