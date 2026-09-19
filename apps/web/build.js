import { rm, mkdir, copyFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = dirname(fileURLToPath(import.meta.url))
const outdir = join(root, 'dist')
const serve = process.argv.includes('--serve')

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

// The vision worker is a separate entry point so it can be loaded with
// `new Worker(url)` instead of being inlined into the main bundle.
const options = {
  entryPoints: {
    main: join(root, 'src/main.ts'),
    'vision.worker': join(root, 'src/vision.worker.ts')
  },
  outdir,
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  splitting: false,
  sourcemap: true,
  minify: !serve,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': serve ? '"development"' : '"production"' }
}

async function copyStatic() {
  for (const name of await readdir(root)) {
    if (name.endsWith('.html') || name === 'styles.css' || name === '_headers') {
      await copyFile(join(root, name), join(outdir, name))
    }
  }
}

if (serve) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  await copyStatic()
  const server = await ctx.serve({ servedir: outdir, port: 5173, host: '127.0.0.1' })
  console.log(`\n  filestrip dev → http://127.0.0.1:${server.port}\n`)
} else {
  await esbuild.build(options)
  await copyStatic()
  console.log('\n  built to apps/web/dist\n')
}
