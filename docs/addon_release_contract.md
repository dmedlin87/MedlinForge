# Add-on Release Contract

Owned addon repositories can participate in BronzeForge update publishing without adding backend infrastructure.

## Required release shape

- Publish a GitHub release in the addon's source repository.
- Use a semver tag such as `v1.2.3` for Stable or `v1.3.0-beta.1` for Beta.
- Attach exactly one addon zip that matches the `assetName` or `assetPattern` configured in [`products/catalog.json`](/Users/dmedl/Projects/MedlinForge/products/catalog.json).
- Ensure the addon's internal `addon_id` matches the BronzeForge product id in the catalog.

## Required follow-up

After the release is published, trigger the central manifest workflow in `dmedlin87/MedlinForge` so GitHub Pages is rebuilt against the latest release set.

Example step for an addon repo workflow:

```yaml
- name: Trigger BronzeForge manifest publish
  env:
    GH_TOKEN: ${{ secrets.BRONZEFORGE_DISPATCH_TOKEN }}
  run: |
    curl -X POST \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer ${GH_TOKEN}" \
      https://api.github.com/repos/dmedlin87/MedlinForge/dispatches \
      -d '{"event_type":"publish-update-manifests","client_payload":{"sourceRepo":"${{ github.repository }}","tag":"${{ github.ref_name }}"}}'
```

## Recommended addon workflow outline

1. build or assemble the addon zip
2. create or update the GitHub release
3. upload the zip asset
4. trigger the central manifest publish dispatch

BronzeForge Manager fetches only the central GitHub Pages manifests. Addon repos never need to host their own manifest endpoint in v1.
