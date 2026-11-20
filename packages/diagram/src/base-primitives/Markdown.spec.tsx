import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'

function render(value: Parameters<typeof Markdown>[0]['value']) {
  return renderToStaticMarkup(
    <MantineProvider>
      <Markdown value={value} />
    </MantineProvider>,
  )
}

describe('Markdown', () => {
  it('renders direct html values', () => {
    expect(render({ html: '<strong>Hello</strong>' })).toContain('<strong>Hello</strong>')
  })

  it('renders serialized rich text values', () => {
    expect(render({ txt: 'Hello' } as any)).toContain('<p>Hello</p>')
  })

  it('renders empty text for foreign empty rich text values', () => {
    const empty = {
      isEmpty: true,
      isMarkdown: false,
      nonEmpty: false,
      $source: null,
      text: null,
      md: null,
      html: null,
    }
    expect(render(empty as any)).toContain('no content')
  })
})
