import type { NonEmptyArray, ViewRuleFilter, WhereOperator } from '@likec4/core/types'
import { cx } from '@likec4/styles/css'
import { Box, HStack, VStack } from '@likec4/styles/jsx'
import { hstack } from '@likec4/styles/patterns'
import {
  Checkbox,
  Popover,
  PopoverDropdown,
  PopoverTarget,
  Text,
  UnstyledButton,
} from '@mantine/core'
import { IconFilter } from '@tabler/icons-react'
import { shallowEqual } from 'fast-equals'
import * as m from 'motion/react-m'
import { useEffect, useState } from 'react'
import { selectDiagramContext, useDiagram, useDiagramSelector } from '../../hooks/useDiagram'
import { useMantinePortalProps } from '../../hooks/useMantinePortalProps'
import { Tooltip } from '../_common'

const EMPTY_FILTERS: ReadonlyArray<ViewRuleFilter> = []

export const selectViewFilters = selectDiagramContext(
  s => s.view.filters ?? EMPTY_FILTERS,
  (a, b) => shallowEqual(a, b),
)

export function FilterControl() {
  const diagram = useDiagram()
  const filters = useDiagramSelector(selectViewFilters)
  const portalProps = useMantinePortalProps()
  const [opened, setOpened] = useState(false)
  const [hiddenFilters, setHiddenFilters] = useState<string[]>([])

  // Reset the runtime filter when leaving the view (the component is keyed by view id).
  useEffect(() => () => diagram.setWhereFilter(null), [diagram])

  if (filters.length === 0) {
    return null
  }

  const applyHiddenFilters = (nextHidden: string[]) => {
    setHiddenFilters(nextHidden)
    const active = filters.filter(f => nextHidden.includes(f.filter))
    if (active.length === 0) {
      diagram.setWhereFilter(null)
      return
    }
    const clauses = active.map((f): WhereOperator => ({ not: f.where }))
    const where: WhereOperator = clauses.length === 1
      ? clauses[0]!
      : { and: clauses as NonEmptyArray<WhereOperator> }
    diagram.setWhereFilter(where)
  }

  const hiddenCount = hiddenFilters.length

  return (
    <Popover
      position="bottom-end"
      shadow="md"
      opened={opened}
      onChange={setOpened}
      clickOutsideEvents={['pointerdown', 'mousedown', 'click']}
      {...portalProps}
    >
      <PopoverTarget>
        <Tooltip label="Filters" disabled={opened}>
          <UnstyledButton
            component={m.button}
            layout="position"
            aria-label="Filters"
            aria-selected={opened || hiddenCount > 0}
            whileTap={{
              scale: 0.95,
              translateY: 1,
            }}
            onClick={e => {
              e.stopPropagation()
              setOpened(v => !v)
            }}
            className={cx(
              'group',
              hstack({
                gap: '1',
                paddingInline: 'xs',
                paddingBlock: 'xxs',
                userSelect: 'none',
                layerStyle: 'likec4.panel.action',
                _selected: {
                  backgroundColor: {
                    base: 'primary.body',
                    _hover: 'primary.body.hover',
                  },
                  color: {
                    base: 'primary.text',
                    _hover: 'primary.text',
                  },
                },
              }),
            )}
          >
            <IconFilter size={15} stroke={1.8} />
            {hiddenCount > 0 && (
              <Box
                css={{
                  fontSize: 'xxs',
                  fontWeight: 'bold',
                  lineHeight: '1',
                }}
              >
                {hiddenCount}
              </Box>
            )}
          </UnstyledButton>
        </Tooltip>
      </PopoverTarget>
      <PopoverDropdown
        onClick={e => e.stopPropagation()}
        style={{ minWidth: 200 }}
      >
        <VStack gap="2" alignItems="stretch">
          <HStack justifyContent="space-between" gap="3">
            <Text size="xs" fw={600} c="dimmed">
              Show systems
            </Text>
            {hiddenCount > 0 && (
              <UnstyledButton
                onClick={() => applyHiddenFilters([])}
                style={{ fontSize: 11, opacity: 0.8 }}
              >
                Show all
              </UnstyledButton>
            )}
          </HStack>
          {filters.map(item => {
            const checked = !hiddenFilters.includes(item.filter)
            return (
              <Checkbox
                key={item.filter}
                size="xs"
                label={item.filter}
                checked={checked}
                onChange={event => {
                  const isChecked = event.currentTarget.checked
                  const next = isChecked
                    ? hiddenFilters.filter(f => f !== item.filter)
                    : [...hiddenFilters, item.filter]
                  applyHiddenFilters(next)
                }}
              />
            )
          })}
        </VStack>
      </PopoverDropdown>
    </Popover>
  )
}
