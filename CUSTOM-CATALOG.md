# Custom Marinara Catalog

This repository is arranged as three branches:

- `upstream-marinara` mirrors `Pasta-Devs/Marinara-Agents`.
- `agents` stores our custom capability package sources under `custom-packages/`.
- `main` is the generated catalog that Marinara should consume.

The generated catalog URL should point at `main`, for example:

```text
https://raw.githubusercontent.com/<owner>/<repo>/main/catalog/v2/catalog.json
```

`main` is rebuilt by GitHub Actions from the latest `upstream-marinara` and
`agents` branch contents. Do not hand-edit catalog JSON or generated artifacts
on `main`; update the input branches instead.
