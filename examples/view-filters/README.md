# View filters example

This example demonstrates the `filter` view rule. Each filter is declared in the view DSL and
appears as a checkbox in the top navigation panel. All filters are enabled by default; clearing a
checkbox hides the matching systems, their nested children, and every relationship connected to
them.

## Run

From the repository root:

```bash
pnpm build
node packages/likec4/bin/likec4.mjs start examples/view-filters
```

Open the **System Landscape** view and click the funnel icon in the top panel.

## What to try

The model has three tagged groups:

| Filter              | Tags           | Systems hidden when cleared       |
| ------------------- | -------------- | --------------------------------- |
| External systems    | `#external`    | Stripe, Salesforce, Tax Authority |
| Government systems  | `#government`  | Tax Authority, Health Registry    |
| On-premises systems | `#on-premises` | Legacy ERP, Mainframe             |

Clear all three checkboxes to hide every tagged system, leaving only the internal `Core Platform`
and `Data Platform` with the customer and government auditor actors.

## DSL

Filters can be declared once in a `global` block (applying automatically to every element and
deployment view in the project) or per view:

```likec4
global {
  filter 'External systems' where tag is #external
  filter 'Government systems' where tag is #government
  filter 'On-premises systems' where tag is #on-premises
}

views {
  view landscape {
    title 'System Landscape'
    include *
  }
}
```

`where` accepts the same conditions as `include`/`exclude` predicates: tags, kinds, metadata, and
their `and` / `or` / `not` combinations. A view can also add its own per-view filters (or override a
global filter with the same label); the `containers` view adds a metadata filter:

```likec4
filter 'Critical components' where metadata.critical is true
```

Clearing it hides the `Back Office` container together with its nested children.

Per-view filters are also inherited by views that use `extends`, and filters work in any element or
deployment view.
