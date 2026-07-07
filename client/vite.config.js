import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function getGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'buildlite-V1-1'
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILDLITE_BRANCH__: JSON.stringify(getGitBranch()),
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3001',
        changeOrigin: true,
        secure: true
      }
    }
  }
})


