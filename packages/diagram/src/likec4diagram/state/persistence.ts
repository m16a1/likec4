import { isBoolean } from 'remeda'
import type { TogglableFeature } from '../../context/DiagramFeatures'

type PersistedToggledFeatures = Partial<Record<`enable${TogglableFeature}`, boolean>>

const key = `likec4:diagram:toggledFeatures`

const togglableKeys = ['enableReadOnly', 'enableColorizeEdges'] as const

/**
 * Picks only togglable features with boolean values
 * (ignores unknown keys, e.g. persisted by previous versions)
 */
function pickTogglable(value: unknown): PersistedToggledFeatures {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const record = value as Record<string, unknown>
  const result: PersistedToggledFeatures = {}
  for (const key of togglableKeys) {
    const feature = record[key]
    if (isBoolean(feature)) {
      result[key] = feature
    }
  }
  return result
}

export const DiagramToggledFeaturesPersistence = {
  read(): PersistedToggledFeatures | null {
    try {
      let fromStorage = sessionStorage.getItem(key)
      if (fromStorage) {
        return pickTogglable(JSON.parse(fromStorage))
      }
      return null
    } catch (e) {
      if (import.meta.env.MODE !== 'test') {
        console.error(`Error reading fromStorage ${key}:`, e)
      }

      return null
    }
  },
  write<F extends PersistedToggledFeatures>(toggledFeatures: F): F {
    sessionStorage.setItem(key, JSON.stringify(pickTogglable(toggledFeatures)))
    return toggledFeatures
  },
}
