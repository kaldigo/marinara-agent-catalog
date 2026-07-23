# Marinara Custom Packages

This branch contains capability package sources.

Each root folder is one source unit. Add a `marinara-source.json` file to opt it
into the generated `main` catalog and describe how the workflow should prepare
it.

The current legacy UI extensions are built with their existing `npm run build`
scripts, then wrapped into capability package artifacts by `main`'s catalog
merge workflow.

