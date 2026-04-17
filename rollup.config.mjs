import { nodeResolve } from "@rollup/plugin-node-resolve"
import commonjs from "@rollup/plugin-commonjs"
import inject from "@rollup/plugin-inject"
import terser from "@rollup/plugin-terser"
import gzipPlugin from "rollup-plugin-gzip"

import { brotliCompress } from "zlib"
import { promisify } from "util"

/* global Buffer */
const brotliPromise = promisify(brotliCompress)

const sharedPlugins = [
  gzipPlugin({
    gzipOptions: { level: 9 }
  }),
  gzipPlugin({
    customCompression: content => brotliPromise(Buffer.from(content)),
    fileName: ".br"
  })
]

export default [
  {
    input: "./src/index.js",
    output: [
      {
        file: "./app/assets/javascript/lexxy.js",
        format: "esm",
        sourcemap: true
      },
      {
        file: "./app/assets/javascript/lexxy.min.js",
        format: "esm",
        plugins: [ terser() ]
      }
    ],
    external: [
      "@rails/activestorage"
    ],
    plugins: [
      nodeResolve(),
      commonjs(),
      // Inject Prism for prismjs language components that expect a global Prism
      inject({
        Prism: ["prismjs", "default"],
        include: "**/prismjs/components/**"
      }),
      ...sharedPlugins
    ]
  },
  // Standalone show-page preview modal. Host apps pin "lexxy-content-preview"
  // and import it on pages that render ActionText content without the editor.
  {
    input: "./src/preview/content_preview.js",
    output: {
      file: "./app/assets/javascript/lexxy-content-preview.js",
      format: "esm",
      sourcemap: true
    },
    plugins: [
      nodeResolve(),
      commonjs(),
      ...sharedPlugins
    ]
  }
]
