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
    expect(views['ranked']).not.toHaveProperty('placement')
    expect(views['withoutPlacement']).not.toHaveProperty('placement')
  })

  it('changes the layout hash of a view', async ({ expect }) => {
    const { validate, buildModel } = createTestServices()
    await validate(`
      ${model}
      views {
        view one {
          placement surround
          include *
        }
        view two {
          include *
        }
      }
    `)
    const { views } = await buildModel()
    const hashOf = (id: string) => views[id]!.hash
    expect(hashOf('one')).not.toEqual(hashOf('two'))
  })
})
