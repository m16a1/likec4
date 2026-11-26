import { WithFileSystem, WithLikeC4ManualLayouts } from '@likec4/language-server/filesystem'
import {
  createLanguageServices as createCustomLanguageServices,
  NoFileSystem,
  NoLikeC4ManualLayouts,
  WithGraphviz,
} from '@likec4/language-server/module'
import { GraphvizWasmAdapter } from '@likec4/layouts'
import { GraphvizBinaryAdapter } from '@likec4/layouts/graphviz/binary'
import { rootLogger } from '@likec4/log'
import defu from 'defu'
import { resolve } from 'node:path'
import k from 'tinyrainbow'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'
import type { LikeC4Langium } from '../common/LikeC4'

export type CreateLanguageServiceOptions = {
  /**
   * Whether to use the file system for the language service.
   * @default true
   */
  useFileSystem?: boolean

  /**
   * Whether to read manual layouts from the workspace.
   * @default true
   */
  manualLayouts?: boolean

  /**
   * Whether to watch for changes in the workspace.
   * @default false
   */
  watch?: boolean

  /**
   * Whether to use the `dot` binary for layouting or the WebAssembly version.
   * @default 'wasm'
   */
  graphviz?: 'wasm' | 'binary'

  /**
   * Directory for a persistent layout cache.
   * When set, computed view layouts are stored on disk and reused by later runs.
   * Layout format version and Graphviz mode are appended to the directory.
   * @default undefined (layouts are cached in memory only)
   */
  viewsCacheDir?: string | undefined
}

export function createLanguageServices(
  opts?: CreateLanguageServiceOptions,
): LikeC4Langium {
  const logger = rootLogger.getChild('lang')

  const options = defu(
    opts,
    <CreateLanguageServiceOptions> {
      useFileSystem: true,
      manualLayouts: true,
      watch: false,
      graphviz: 'wasm',
    },
  )

  const useDotBin = options.graphviz === 'binary'

  logger.info(`${k.dim('layout')} ${useDotBin ? 'binary' : 'wasm'}`)

  const viewsStorage = options.viewsCacheDir
    ? createStorage({
      driver: fsDriver({
        // Namespaced by cache format and layout engine, so switching either never reuses stale layouts
        base: resolve(options.viewsCacheDir, 'v1', useDotBin ? 'binary' : 'wasm'),
      }),
    })
    : undefined

  if (viewsStorage) {
    logger.info(`${k.dim('layout cache:')} ${options.viewsCacheDir}`)
  }

  const langium = createCustomLanguageServices(
    {
      ...options.useFileSystem
        ? {
          ...WithFileSystem(options.watch),
          ...options.manualLayouts ? WithLikeC4ManualLayouts : NoLikeC4ManualLayouts,
        }
        : {
          ...NoFileSystem,
          ...NoLikeC4ManualLayouts,
        },
      ...WithGraphviz(useDotBin ? new GraphvizBinaryAdapter() : new GraphvizWasmAdapter()),
      ...(viewsStorage ? { viewsStorage } : {}),
    },
  )
  return langium
}
