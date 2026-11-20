---
'likec4': patch
'@likec4/core': patch
'@likec4/language-server': patch
'@likec4/generators': patch
'@likec4/diagram': patch
---

Add `filter` rules (per view or project-wide in `global`) that define interactive filter checkboxes in the diagram's top navigation panel. Filters are enabled by default; clearing a checkbox hides matching elements, their nested children, and connected relationships. Filters can be defined globally in `global { ... }`, per view, or reused through inherited views.
