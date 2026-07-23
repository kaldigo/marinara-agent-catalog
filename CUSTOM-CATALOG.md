# Custom Marinara Catalog

This repository is arranged around three inputs:

- `Pasta-Devs/Marinara-Agents` `main` is fetched directly during rebuilds.
- `packages` stores our custom capability package sources.
- `agents` stores our custom prompt-agent sources.
- `main` is the generated catalog that Marinara should consume.

The generated catalog URL should point at `main`, for example:

```text
https://raw.githubusercontent.com/<owner>/<repo>/main/catalog/v2/catalog.json
```

`main` is rebuilt by GitHub Actions from the latest official Marinara catalog,
the `packages` branch, and the `agents` branch. Scheduled refreshes poll the
official catalog directly, so no mirror branch is required. Do not hand-edit
catalog JSON or generated artifacts on `main`; update the input branches instead.
