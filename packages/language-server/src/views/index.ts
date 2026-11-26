import { type GraphvizPort, GraphvizWasmAdapter } from '@likec4/layouts'
import type { Storage } from 'unstorage'
import type { LikeC4Services } from '../module'

export { DefaultLikeC4Views, type LayoutViewParams, type LikeC4Views } from './LikeC4Views'

export interface LikeC4ViewsModuleContext {
  graphviz: (services: LikeC4Services) => GraphvizPort
  /**
   * Optional external storage for the layout cache.
   * When not provided, layouts are cached in memory.
   */
  viewsStorage?: Storage | undefined
}

export const WithWasmGraphviz: LikeC4ViewsModuleContext = {
  graphviz() {
    return new GraphvizWasmAdapter()
  },
}

export function WithGraphviz(graphviz: GraphvizPort): LikeC4ViewsModuleContext {
  return {
    graphviz() {
      return graphviz
    },
  }
}
