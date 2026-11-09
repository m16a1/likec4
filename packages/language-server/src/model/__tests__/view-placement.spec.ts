import { describe, it } from 'vitest'
import { createTestServices } from '../../test/testServices'

const model = `
  specification {
    element component
  }
  model {
    a = component 'A'
    b = component 'B'
    surround = component 'Element named like the keyword'
    a -> b
  }
`

describe('view placement', () => {
  it('parses `placement surround` into computed element views', async ({ expect }) => {
    const { validate, buildModel } = createTestServices()
    const { errors } = await validate(`
      ${model}
      views {
        view withSurround {
          placement surround
          include *
        }
        view withColon {
          placement: surround;
          include *
        }
        view ranked {
          placement ranked
          include *
        }
        view withoutPlacement {
          include *
        }
      }
    `)
    expect(errors).toEqual([])
    const { views } = await buildModel()
    expect(views['withSurround']).toHaveProperty('placement', 'surround')
    expect(views['withColon']).toHaveProperty('placement', 'surround')
    expect(views['ranked']).toHaveProperty('placement', 'ranked')
    expect(views['withoutPlacement']).not.toHaveProperty('placement')
  })

  it('uses the same layout hash for default and explicit surround placement', async ({ expect }) => {
    const hashes = await Promise.all(['', 'placement surround', 'placement ranked'].map(async placement => {
      const { validate, buildModel } = createTestServices()
      const { errors } = await validate(`
        ${model}
        views {
          view one {
            ${placement}
            include *
          }
        }
      `)
      expect(errors).toEqual([])
      const { views } = await buildModel()
      return views['one']!.hash
    }))
    expect(hashes[0]).toEqual(hashes[1])
    expect(hashes[0]).not.toEqual(hashes[2])
  })
})
