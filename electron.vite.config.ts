import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          // the app window and the menu bar popover are separate documents: the
          // popover shares the React/Motion chunk but skips the panes, the
          // reducer and DataContext, none of which it needs to render a summary
          index: resolve('src/renderer/index.html'),
          widget: resolve('src/renderer/widget.html')
        }
      }
    }
  }
})
