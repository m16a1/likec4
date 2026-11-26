import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveViewsCacheDir, title, useHashHistory, withoutDefault } from './options'

describe('withoutDefault', () => {
  it('drops the default and keeps it in the help', () => {
    const option = withoutDefault(title)

    expect(option).not.toHaveProperty('default')
    expect(option.defaultDescription).toBe('"LikeC4"')
    expect(option.alias).toBe(title.alias)
  })

  it('keeps an option without the default as is', () => {
    expect(withoutDefault(useHashHistory)).toEqual(useHashHistory)
  })
})

describe('resolveViewsCacheDir', () => {
  it('is disabled when the flag is omitted', () => {
    expect(resolveViewsCacheDir(undefined, '/workspace', '1.2.3')).toBeUndefined()
  })

  it('uses the default directory in the workspace when --cache has no value', () => {
    const result = resolveViewsCacheDir('', '/workspace', '1.2.3')
    expect(result).toBe(resolve('/workspace', 'node_modules', '.cache', 'likec4', '1.2.3'))
  })

  it('resolves a custom directory and appends the version', () => {
    expect(resolveViewsCacheDir('./cache', '/workspace', '1.2.3')).toBe(resolve('./cache', '1.2.3'))
  })
})
