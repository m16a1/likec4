# View filters example

This example demonstrates the `filter` view rule. Each filter is declared in the view DSL and
appears as a checkbox in the top navigation panel. Enabling a filter hides the matching elements,
their nested children, and every relationship connected to them.

## Run

From the repository root:

```bash
pnpm build
node packages/likec4/bin/likec4.mjs start examples/view-filters
```

Open the **System Landscape** view and click the funnel icon in the top panel.

## What to try

The model has three tagged groups:

| Filter              | Tags           | Hidden systems                    |
| ------------------- | -------------- | --------------------------------- |
| External systems    | `#external`    | Stripe, Salesforce, Tax Authority |
| Government systems  | `#government`  | Tax Authority, Health Registry    |
| On-premises systems | `#on-premises` | Legacy ERP, Mainframe             |

Enable all three filters to leave only the internal `Core Platform` and `Data Platform`, with the
customer and government auditor actors.

## DSL

```likec4
views {
  view landscape {
    title 'System Landscape'
    include *

    filter 'External systems' where tag is #external
    filter 'Government systems' where tag is #government
    filter 'On-premises systems' where tag is #on-premises
  }
}
```

`where` accepts the same conditions as `include`/`exclude` predicates: tags, kinds, metadata, and
their `and` / `or` / `not` combinations. The `containers` view demonstrates a metadata filter:

```likec4
filter 'Critical components' where metadata.critical is true
```

Filters are inherited by views that use `extends`, and they are available in any element or
deployment view that declares them.
