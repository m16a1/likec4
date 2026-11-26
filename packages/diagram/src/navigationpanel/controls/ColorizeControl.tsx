import { IconPalette } from '@tabler/icons-react'
import { useEnabledFeatures } from '../../context/DiagramFeatures'
import { useDiagram } from '../../hooks/useDiagram'
import { PanelActionIcon } from '../_common'

/**
 * Toggles per-edge colorization: every arrow gets its own color and close
 * arrows are guaranteed to use visually different colors.
 */
export function ColorizeControl() {
  const diagram = useDiagram()
  const { enableColorizeEdges } = useEnabledFeatures()

  return (
    <PanelActionIcon
      variant={enableColorizeEdges ? 'filled' : 'default'}
      tooltip={enableColorizeEdges ? 'Hide arrow colors' : 'Colorize arrows'}
      aria-label="Colorize arrows"
      aria-pressed={enableColorizeEdges}
      onClick={e => {
        e.stopPropagation()
        diagram.toggleFeature('ColorizeEdges')
      }}>
      <IconPalette size={15} stroke={1.8} />
    </PanelActionIcon>
  )
}
